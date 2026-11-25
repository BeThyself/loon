import json, os, tempfile, unittest
import auth_store

class StoreTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
  self.cfg=os.path.join(self.tmp.name,'config.json'); self.lock=os.path.join(self.tmp.name,'lock')
 def save(self,p,now=3000): return auth_store.save_capture(p,self.cfg,self.lock,now_ms=now)
 def read(self):
  with open(self.cfg) as f: return json.load(f)
 def base(self,**kw):
  p={'schema':8,'source':'auth-response','observed_at':1000,'refresh_cookie':'refresh-A','cookie':'cf_clearance=fake-clearance','sid':'sid-A','token':'access-A','uid':'user-A'}; p.update(kw); return p
 def test_reject_legacy_payload(self):
  with self.assertRaises(auth_store.StoreError) as e: self.save({'cookie':'legacy'})
  self.assertEqual(e.exception.code,'schema_required')
 def test_refresh_separate_from_clearance_cookie(self):
  r=self.save(self.base()); c=self.read()
  self.assertTrue(r['has_refresh']); self.assertEqual(c['new_api_refresh'],'refresh-A'); self.assertEqual(c['cookie'],'cf_clearance=fake-clearance')
 def test_missing_refresh_never_erases_prior_and_cookie_updates(self):
  self.save(self.base()); r=self.save(self.base(observed_at=2000,refresh_cookie='',cookie='cf_clearance=fake-clearance'))
  c=self.read(); self.assertEqual(c['new_api_refresh'],'refresh-A'); self.assertEqual(c['cookie'],'cf_clearance=fake-clearance'); self.assertTrue(r['has_refresh'])
 def test_uid_change_clears_old_auth_fields(self):
  self.save(self.base()); self.save(self.base(observed_at=2000,refresh_cookie='refresh-B',cookie='cf_clearance=fake-clearance',sid='sid-B',token='access-B',uid='user-B'))
  c=self.read(); self.assertEqual((c['uid'],c['sid'],c['token'],c['new_api_refresh']),('user-B','sid-B','access-B','refresh-B'))
 def test_old_observation_cannot_rollback(self):
  self.save(self.base(observed_at=2000,refresh_cookie='refresh-B'))
  with self.assertRaises(auth_store.StoreError) as e: self.save(self.base(observed_at=1000,refresh_cookie='refresh-A'))
  self.assertEqual(e.exception.code,'stale_observation'); self.assertEqual(self.read()['new_api_refresh'],'refresh-B')
 def test_only_cf_clearance_is_saved(self):
  self.save(self.base(cookie='session=not-kept; cf_clearance=fake-clearance; other=no'))
  self.assertEqual(self.read()['cookie'],'cf_clearance=fake-clearance')

if __name__=='__main__': unittest.main()

class ProbeTests(unittest.TestCase):
 def setUp(self):
  import auth_probe
  self.probe=auth_probe
  self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
  self.cfg=os.path.join(self.tmp.name,'config.json'); self.lock=os.path.join(self.tmp.name,'auth.lock')
 def test_missing_refresh_does_not_contact_site(self):
  from unittest.mock import patch
  p=self.probe.Probe({'sid':'S'})
  with patch.object(p,'_call',side_effect=AssertionError('network')):
   self.assertEqual(p.refresh(self.cfg,self.lock)['code'],'missing_refresh')
 def test_raw_refresh_value_is_used_as_named_cookie(self):
  p=self.probe.Probe({'new_api_refresh':'raw-refresh-value','cookie':'cf_clearance=fake-clearance'})
  self.assertEqual([(c.name,c.value) for c in p.jar if c.name=='new_api_refresh'],[('new_api_refresh','raw-refresh-value')])
 def test_rotated_token_saved_before_self_failure(self):
  from unittest.mock import patch
  auth_store.atomic_write(self.cfg,{'new_api_refresh':'R1','token':'T1','uid':'U','sid':'S'})
  p=self.probe.Probe(auth_store.read_config(self.cfg))
  with patch.object(p,'_call',side_effect=[(200,{'success':True,'data':{'access_token':'T2','uid':'U','session':{'sid':'S2'}}}),(401,{'success':False})]):
   r=p.refresh(self.cfg,self.lock)
  self.assertFalse(r['ok']); self.assertEqual(auth_store.read_config(self.cfg)['token'],'T2')
 def test_concurrent_capture_wins_over_old_probe(self):
  from unittest.mock import patch
  auth_store.atomic_write(self.cfg,{'new_api_refresh':'R1','token':'T1','auth_revision':'old'})
  p=self.probe.Probe(auth_store.read_config(self.cfg))
  def call(*a, **kw):
   auth_store.save_capture({'schema':8,'source':'auth-response','observed_at':2000,'refresh_cookie':'R3','token':'T3','uid':'U'},self.cfg,self.lock)
   return 200,{'success':True,'data':{'access_token':'T2'}}
  with patch.object(p,'_call',side_effect=call): r=p.refresh(self.cfg,self.lock)
  self.assertEqual(r['code'],'credentials_changed'); self.assertEqual(auth_store.read_config(self.cfg)['token'],'T3')
 def test_verify_returns_expiry_but_no_secrets(self):
  from unittest.mock import patch
  p=self.probe.Probe({'token':'secret-access'})
  with patch.object(p,'_call',return_value=(200,{'success':True,'data':{'id':7,'token':'secret','expires_at':2000000000}})):
   r=p.verify()
  self.assertEqual(r['uid'],'7'); self.assertIn('expires_at',r); self.assertNotIn('secret',json.dumps(r))

class CheckinTests(unittest.TestCase):
 def test_beijing_date_and_uid_dedup(self):
  import checkin
  self.assertEqual(checkin.beijing_date(0),'1970-01-01')
  self.assertEqual(checkin.beijing_date(16*3600),'1970-01-02')
  self.assertTrue(checkin.done_today({'date':'2026-01-01','how':'already'},'U','2026-01-01'))
  self.assertFalse(checkin.done_today({'date':'2026-01-01','uid':'A','how':'ok'},'B','2026-01-01'))

class SafetyTests(StoreTests):
 def test_stable_refresh_sid_reports_skipped_even_with_new_observation(self):
  self.save(self.base()); r=self.save(self.base(observed_at=2000,cookie='cf_clearance=fake-clearance'))
  self.assertTrue(r['skipped']); self.assertEqual(self.read()['cookie'],'cf_clearance=fake-clearance')
 def test_conflicting_session_without_identity_cannot_merge_old_token(self):
  self.save(self.base()); self.save(self.base(observed_at=2000,uid='',sid='sid-B',token='',refresh_cookie='refresh-B'))
  self.assertNotIn('token',self.read())
 def test_equal_timestamp_conflicting_refresh_cannot_rollback(self):
  self.save(self.base())
  with self.assertRaises(auth_store.StoreError): self.save(self.base(refresh_cookie='old'))

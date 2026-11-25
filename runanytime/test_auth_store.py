import os,tempfile,unittest
import auth_store

class ExtraStoreTests(unittest.TestCase):
 def setUp(self):
  self.d=tempfile.TemporaryDirectory();self.addCleanup(self.d.cleanup)
  self.path=os.path.join(self.d.name,'config.json');self.lock=os.path.join(self.d.name,'config.lock')
  auth_store.atomic_write(self.path,{'uid':'A','sid':'S','token':'T','new_api_refresh':'R','auth_observed_at':100})
 def capture(self,**kw):
  p={'schema':8,'source':'auth-response','uid':'A','sid':'S','observed_at':200};p.update(kw)
  return auth_store.save_capture(p,self.path,self.lock)
 def test_changed_uid_without_token_clears_old_token(self):
  self.capture(uid='B',sid='S2',refresh_cookie='R2')
  self.assertNotIn('token',auth_store.read_config(self.path))
 def test_refresh_material_cannot_be_taken_from_ordinary_cookie(self):
  self.capture(cookie='new_api_refresh=evil; cf_clearance=fake-clearance')
  self.assertEqual(auth_store.read_config(self.path)['new_api_refresh'],'R')
 def test_plain_request_source_rejected(self):
  with self.assertRaises(auth_store.StoreError): self.capture(source='request')
 def test_mode_600(self):
  self.capture(refresh_cookie='R2')
  self.assertEqual(os.stat(self.path).st_mode & 0o777,0o600)

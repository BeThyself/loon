import unittest,tempfile,os,json
from unittest.mock import patch
import checkin,auth_probe,auth_store
class LimitTests(unittest.TestCase):
 def test_rate_limit_not_classified_as_expired(self):
  with tempfile.TemporaryDirectory() as d:
   path=d+'/config.json';lock=d+'/lock';cfg={'new_api_refresh':'fake','sid':'fake','uid':'7'};auth_store.atomic_write(path,cfg);p=auth_probe.Probe(cfg)
   p.last_response_meta={'retry_after_seconds':70}
   with patch.object(p,'_call',return_value=(429,{})):
    r=p.refresh(path,lock)
   self.assertEqual(r['code'],'refresh_rate_limited');self.assertEqual(r['retry_after_seconds'],70)
 def test_retry_after_seconds_and_date(self):
  self.assertEqual(auth_probe.retry_after_seconds('90',now=0),90)
  self.assertEqual(auth_probe.retry_after_seconds('Thu, 01 Jan 1970 00:02:00 GMT',now=0),120)
  self.assertIsNone(auth_probe.retry_after_seconds('nonsense',now=0))
 def test_bounded_429_retry_succeeds(self):
  waits=[];results=[{'ok':False,'status':429,'code':'refresh_rate_limited'},{'ok':True,'status':200}]
  with patch.object(checkin,'refresh_token',side_effect=results):
   r=checkin.refresh_with_backoff(object(),{},wait=waits.append)
  self.assertTrue(r['ok']);self.assertEqual(waits,[60])
 def test_exhausted_429_is_three_calls_not_infinite(self):
  waits=[]
  with patch.object(checkin,'refresh_token',return_value={'ok':False,'status':429,'code':'refresh_rate_limited'}) as f:
   r=checkin.refresh_with_backoff(object(),{},wait=waits.append)
  self.assertEqual(f.call_count,3);self.assertEqual(waits,[60,180]);self.assertEqual(r['status'],429)
 def test_large_retry_after_not_shortened(self):
  waits=[]
  with patch.object(checkin,'refresh_token',return_value={'ok':False,'status':429,'code':'refresh_rate_limited','retry_after_seconds':3600}) as f:
   checkin.refresh_with_backoff(object(),{},wait=waits.append)
  self.assertEqual(f.call_count,1);self.assertEqual(waits,[])
 def test_post_refresh_self_429_does_not_rotate_again(self):
  with patch.object(checkin,'refresh_token',return_value={'ok':False,'status':429,'code':'self_failed'}) as f:
   checkin.refresh_with_backoff(object(),{},wait=lambda seconds: self.fail('must not wait'))
  self.assertEqual(f.call_count,1)
 def test_auth_failure_never_retried(self):
  waits=[]
  with patch.object(checkin,'refresh_token',return_value={'ok':False,'status':401}) as f:
   checkin.refresh_with_backoff(object(),{},wait=waits.append)
  self.assertEqual(f.call_count,1);self.assertEqual(waits,[])
 def test_main_reports_refresh_429_not_original_self_401(self):
  with tempfile.TemporaryDirectory() as d:
   cfg={'uid':'7','token':'fake','new_api_refresh':'fake'}
   with patch.object(checkin,'LOCK_PATH',d+'/lock'),patch.object(checkin,'STATE_PATH',d+'/state'),patch.object(checkin,'load_cfg',return_value=cfg),patch.object(checkin,'Session') as S,patch.object(checkin,'refresh_with_backoff',return_value={'ok':False,'status':429,'code':'refresh_rate_limited'}),patch.object(checkin,'notify') as n:
    S.return_value.call.return_value=(401,{'success':False});self.assertEqual(checkin.main(),1)
   title,body=n.call_args.args[1:];self.assertIn('限流',title);self.assertIn('429',body);self.assertNotIn('登录态失效',title);self.assertNotIn('HTTP 401',body)
if __name__=='__main__':unittest.main()

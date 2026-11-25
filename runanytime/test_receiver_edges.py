import unittest,time
import auth_store
class ReceiverEdges(unittest.TestCase):
 def test_header_value_rejects_cookie_injection(self):
  for value in ['secret; another=x','secret\x00','secret\r\nCookie: injected']:
   with self.assertRaises(auth_store.StoreError):auth_store.refresh_value(value)
 def test_strict_receiver_capture_identity(self):
  good={'schema':8,'source':'auth-response','uid':'7','sid':'s','token':'t','refresh_cookie':'r','observed_at':int(time.time()*1000)}
  auth_store.validate_capture(good)
  for field in ['uid','sid','token','refresh_cookie']:
   x=dict(good);x.pop(field)
   with self.assertRaises(auth_store.StoreError):auth_store.validate_capture(x)
 def test_future_observation_rejected(self):
  with self.assertRaises(auth_store.StoreError):auth_store.validate_capture({'schema':8,'source':'auth-response','uid':'7','sid':'s','token':'t','refresh_cookie':'r','observed_at':int(time.time()*1000)+600000})
if __name__=='__main__':unittest.main()

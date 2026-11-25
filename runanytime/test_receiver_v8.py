import importlib.util,json,os,tempfile,threading,unittest
from http.server import ThreadingHTTPServer
from urllib import request,error
class ReceiverTests(unittest.TestCase):
 def test_receiver_only_saves_and_deduplicates(self):
  with tempfile.TemporaryDirectory() as tmp:
   with open(tmp+'/receiver.token','w') as f:f.write('test-path\ntest-token\n')
   prior=os.environ.get('RUNANYTIME_DIR');os.environ['RUNANYTIME_DIR']=tmp
   try:
    spec=importlib.util.spec_from_file_location('recvtest',os.path.join(os.path.dirname(__file__),'receiver.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
   finally:
    if prior is None:os.environ.pop('RUNANYTIME_DIR',None)
    else:os.environ['RUNANYTIME_DIR']=prior
   s=ThreadingHTTPServer(('127.0.0.1',0),m.Handler);t=threading.Thread(target=s.serve_forever,daemon=True);t.start()
   def call(path,body=None,secret='test-token'):
    r=request.Request('http://127.0.0.1:'+str(s.server_port)+path,data=json.dumps(body).encode() if body is not None else None,headers={'X-Token':secret,'Content-Type':'application/json'})
    try:
     with request.urlopen(r,timeout=5) as out:return out.status,json.load(out)
    except error.HTTPError as e:return e.code,json.load(e)
   try:
    self.assertEqual(call('/test-path/status',secret='wrong')[0],401)
    self.assertEqual(call('/test-path/cookie',{'token':'old'})[0],400)
    p={'schema':8,'source':'auth-response','observed_at':1000,'refresh_cookie':'test-refresh','token':'test-access','sid':'test-session','uid':'7'}
    status,result=call('/test-path/cookie',p);self.assertEqual(status,200);self.assertTrue(result['has_refresh']);self.assertFalse(result['skipped'])
    self.assertTrue(call('/test-path/cookie',p)[1]['skipped']);status,result=call('/test-path/status');self.assertEqual(status,200)
    self.assertNotIn('test-refresh',json.dumps(result));self.assertNotIn('test-access',json.dumps(result));self.assertEqual(os.stat(tmp+'/config.json').st_mode&0o777,0o600)
    self.assertFalse(os.path.exists(tmp+'/state.json'))
   finally:s.shutdown();s.server_close();t.join()
if __name__=='__main__':unittest.main()

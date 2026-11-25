import os,tempfile,threading,json,unittest
from http.server import BaseHTTPRequestHandler,HTTPServer
from urllib.request import Request
import auth_probe,auth_store
class Tests(unittest.TestCase):
 def test_refresh_path_scope_and_rotation_survive_restart(self):
  cfg={'new_api_refresh':'opaque-with=padding','token':'expired','sid':'S','uid':'7'}
  p=auth_probe.Probe(cfg)
  r=Request(auth_probe.BASE+'/api/user/self');p.jar.add_cookie_header(r)
  self.assertNotIn('new_api_refresh',r.get_header('Cookie',''))
  r=Request(auth_probe.BASE+'/api/user/auth/refresh');p.jar.add_cookie_header(r)
  self.assertIn('new_api_refresh=opaque-with=padding',r.get_header('Cookie',''))
 def test_real_http_set_cookie_replaces_old_not_duplicates(self):
  seen=[]
  class H(BaseHTTPRequestHandler):
   def do_POST(self):
    seen.append(self.headers.get('Cookie',''));out=json.dumps({'success':True,'data':{'access_token':'new-access','session':{'sid':'S'},'user':{'id':7}}}).encode();self.send_response(200);self.send_header('Set-Cookie','new_api_refresh=rotated; Path=/api/user/auth; HttpOnly');self.end_headers();self.wfile.write(out)
   def do_GET(self):
    seen.append(self.headers.get('Cookie',''));self.send_response(200);self.end_headers();self.wfile.write(b'{"success":true,"data":{"id":7}}')
   def log_message(self,*a):pass
  server=HTTPServer(('127.0.0.1',0),H);t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
  try:
   with tempfile.TemporaryDirectory() as tmp:
    path=os.path.join(tmp,'config.json');lock=os.path.join(tmp,'config.lock');c={'new_api_refresh':'old-refresh','token':'old-access','uid':'7','sid':'S'};auth_store.atomic_write(path,c)
    p=auth_probe.Probe(c,'http://127.0.0.1:'+str(server.server_port));self.assertTrue(p.refresh(path,lock)['ok']);saved=auth_store.read_config(path)
    self.assertEqual(saved['new_api_refresh'],'rotated');self.assertNotIn('new_api_refresh',seen[-1]);p2=auth_probe.Probe(saved,'http://127.0.0.1:'+str(server.server_port));r=Request(p2.base+'/api/user/auth/refresh');p2.jar.add_cookie_header(r);self.assertEqual(r.get_header('Cookie'),'new_api_refresh=rotated')
  finally:server.shutdown();server.server_close();t.join()
if __name__=='__main__':unittest.main()

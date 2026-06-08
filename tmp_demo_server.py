import http.server, socketserver, os
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),"frontend")
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split("?",1)[0].split("#",1)[0]
        if p.startswith("/static/"): p = p[len("/static"):]   # /static/x -> /x (served from frontend/)
        return os.path.join(ROOT, p.lstrip("/")) if p not in ("","/") else os.path.join(ROOT,"index.html")
    def end_headers(self):
        self.send_header("Cache-Control","no-store"); super().end_headers()
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address=True
socketserver.TCPServer(("127.0.0.1",8781),H).serve_forever()

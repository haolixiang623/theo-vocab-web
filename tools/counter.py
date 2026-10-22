#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
theo-vocab 全站访问计数器（无第三方依赖，Python 3.6+）
- GET  /visits  -> {"count": N}   仅读取
- POST /visits  -> {"count": N}   原子自增后返回新值
- 计数持久化到 /opt/theo-counter/count.json（临时文件 + os.replace 保证原子写）
- 线程锁保证并发自增安全
- 仅监听 127.0.0.1，由宿主 nginx 反向代理对外暴露
"""
import json
import os
import threading
import http.server
import socketserver

HOST = "127.0.0.1"
PORT = 8899
COUNTER_FILE = "/opt/theo-counter/count.json"

_lock = threading.Lock()


def read_count():
    try:
        with open(COUNTER_FILE, "r") as f:
            return int(json.load(f).get("count", 0))
    except Exception:
        return 0


def write_count(n):
    tmp = COUNTER_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"count": n}, f)
    os.replace(tmp, COUNTER_FILE)


def get_count():
    with _lock:
        return read_count()


def inc_count():
    with _lock:
        n = read_count() + 1
        write_count(n)
        return n


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/visits":
            self._send(200, {"count": get_count()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/visits":
            self._send(200, {"count": inc_count()})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *args):
        pass  # 静默访问日志，避免刷盘


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    os.makedirs(os.path.dirname(COUNTER_FILE), exist_ok=True)
    httpd = Server((HOST, PORT), Handler)
    httpd.serve_forever()

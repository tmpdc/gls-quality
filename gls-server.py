# -*- coding: utf-8 -*-
"""格丽思质量管理工作台 · 内网共享服务端

作用：把整套工作台放到一台常开的电脑上，同一个局域网内的同事用浏览器访问，
      所有人共用同一份数据（多人同步）。

特性：
  * 纯 Python 标准库，零依赖，不用装 Node / MySQL / 任何东西
  * 数据存本目录下的 gls-data.json 单文件，好备份、好搬运
  * 每次保存自动留档到 _data_backup（保留最近 60 份，可回滚）
  * 带乐观锁：两个人同时改同一份数据时，后提交者会收到冲突提示，不会静默覆盖
  * 同时托管网页文件，同事直接访问 http://本机IP:8686/ 即可

启动：双击「启动服务.bat」，或在本目录执行  python gls-server.py
"""
import json
import os
import shutil
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, "gls-data.json")
BACKUP_DIR = os.path.join(BASE, "_data_backup")
CONF_FILE = os.path.join(BASE, "gls-server.ini")
DEFAULT_PORT = 8686
MAX_BACKUPS = 60


def resolve_port():
    """端口优先级：命令行数字参数 > gls-server.ini 里的 port > 默认 8686
       想换端口：改 gls-server.ini，或执行 python gls-server.py 9000"""
    for a in sys.argv[1:]:
        if a.isdigit():
            return int(a)
    try:
        import configparser
        cp = configparser.ConfigParser()
        if cp.read(CONF_FILE, encoding="utf-8") and cp.has_option("server", "port"):
            return int(cp.get("server", "port"))
    except Exception as e:
        print("  读取 gls-server.ini 失败，改用默认端口：%s" % e)
    return DEFAULT_PORT


PORT = resolve_port()

_lock = threading.RLock()
_state = {"v": 0, "data": {}, "savedAt": ""}


# ---------------------------------------------------------------- 数据读写
def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def load_data():
    """启动时把磁盘数据读进内存"""
    if not os.path.exists(DATA_FILE):
        return
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            obj = json.load(f)
        if isinstance(obj, dict) and isinstance(obj.get("data"), dict):
            _state["v"] = int(obj.get("v") or 0)
            _state["data"] = obj["data"]
            _state["savedAt"] = obj.get("savedAt") or ""
            print("  已载入既有数据：版本 v%d，%s" % (_state["v"], _state["savedAt"] or "未记录时间"))
        else:
            print("  数据文件格式异常，按空数据处理")
    except Exception as e:
        print("  读取数据失败（按空处理）：%s" % e)


def _backup():
    """保存前留档一份"""
    if not os.path.exists(DATA_FILE):
        return
    try:
        if not os.path.isdir(BACKUP_DIR):
            os.makedirs(BACKUP_DIR)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(DATA_FILE, os.path.join(BACKUP_DIR, "gls-data-%s.json" % stamp))
        files = sorted(f for f in os.listdir(BACKUP_DIR) if f.startswith("gls-data-"))
        for old in files[:-MAX_BACKUPS]:
            try:
                os.remove(os.path.join(BACKUP_DIR, old))
            except OSError:
                pass
    except Exception as e:
        print("  备份失败（不影响保存）：%s" % e)


def write_data(data):
    """写盘并使版本号 +1，返回新版本号"""
    with _lock:
        _backup()
        _state["data"] = data
        _state["v"] += 1
        _state["savedAt"] = _now()
        tmp = DATA_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"v": _state["v"], "savedAt": _state["savedAt"], "data": data},
                      f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, DATA_FILE)
        return _state["v"]


# ---------------------------------------------------------------- 企业微信推送
WECOM_CONF = os.path.join(BASE, "gls-wecom.ini")
_wc = {"token": "", "expire": 0}


def wecom_cfg():
    """读取企业微信配置（gls-wecom.ini）。没配就返回 None，一切照常。"""
    try:
        import configparser
        cp = configparser.ConfigParser()
        if not cp.read(WECOM_CONF, encoding="utf-8"):
            return None
        corpid = (cp.get("app", "corpid", fallback="") or "").strip()
        secret = (cp.get("app", "secret", fallback="") or "").strip()
        agentid = (cp.get("app", "agentid", fallback="") or "").strip()
        if not (corpid and secret and agentid):
            return None
        mp = {}
        if cp.has_section("map"):
            for k, v in cp.items("map"):
                if k and v and not k.startswith(";"):
                    mp[k.strip()] = v.strip()
        return {
            "corpid": corpid, "secret": secret, "agentid": agentid,
            "map": mp,
            "unmapped": (cp.get("option", "unmapped", fallback="all") or "all").strip(),
        }
    except Exception as e:
        print("  [企业微信] 配置读取失败：%s" % e)
        return None


def wecom_token(cfg):
    """取 access_token，带 2 小时缓存"""
    now = time.time()
    if _wc["token"] and now < _wc["expire"]:
        return _wc["token"]
    url = ("https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=%s&corpsecret=%s"
           % (urllib.parse.quote(cfg["corpid"]), urllib.parse.quote(cfg["secret"])))
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            d = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print("  [企业微信] 取 token 失败：%s" % e)
        return ""
    if d.get("errcode") == 0 and d.get("access_token"):
        _wc["token"] = d["access_token"]
        _wc["expire"] = now + int(d.get("expires_in") or 7200) - 300
        return _wc["token"]
    print("  [企业微信] 取 token 被拒：%s" % d)
    return ""


def wecom_send(to, text, flow_id=""):
    """给「人」发企业微信消息。to 可以是姓名，也可以逗号/顿号分隔的多个。"""
    cfg = wecom_cfg()
    if not cfg:
        return {"ok": False, "reason": "not_configured",
                "msg": "还没配置企业微信：请填好 gls-wecom.ini 里的 corpid / secret / agentid"}
    token = wecom_token(cfg)
    if not token:
        return {"ok": False, "reason": "token_failed",
                "msg": "拿不到 access_token：检查 corpid / secret 是否正确、服务器能否访问外网"}

    names = [x.strip() for x in str(to or "").replace("、", ",").replace("|", ",").split(",") if x.strip()]
    ids, unmapped = [], []
    for n in names:
        uid = cfg["map"].get(n)
        if uid:
            ids.append(uid)
        else:
            unmapped.append(n)

    touser = "|".join(ids)
    if unmapped and cfg["unmapped"] == "all":
        touser = (touser + "|@all") if touser else "@all"
    if not touser:
        return {"ok": False, "reason": "no_target",
                "msg": "这些人在 gls-wecom.ini 里没有配企业微信账号，也没有开全员兜底：" + "、".join(unmapped)}

    body = {
        "touser": touser,
        "msgtype": "text",
        "agentid": int(cfg["agentid"]),
        "text": {"content": text},
        "safe": 0,
    }
    req = urllib.request.Request(
        "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=" + token,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "reason": "send_failed", "msg": "发送失败：%s" % e}

    if d.get("errcode") == 0:
        return {"ok": True, "sent_to": touser, "unmapped": unmapped}
    return {"ok": False, "reason": "api_error", "msg": str(d)}


# ---------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    server_version = "GLS-Server/1.0"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE, **kw)

    # ---- 工具 ----
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n <= 0:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    # ---- 跨域预检（小程序 / 别的域名的网页接进来时要走这一步）----
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- 路由 ----
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/version":
            with _lock:
                return self._json(200, {"v": _state["v"], "savedAt": _state["savedAt"]})
        if path == "/api/load":
            with _lock:
                return self._json(200, {"v": _state["v"], "savedAt": _state["savedAt"],
                                        "data": _state["data"]})
        if path == "/api/ping":
            return self._json(200, {"ok": True, "name": "格丽思质量管理工作台共享服务"})
        if path == "/api/wecom/status":
            c = wecom_cfg()
            if not c:
                return self._json(200, {"ok": True, "configured": False,
                                        "msg": "还没配置：请填 gls-wecom.ini 里的 corpid / secret / agentid"})
            return self._json(200, {"ok": True, "configured": True,
                                    "corpid": c["corpid"][:8] + "…",
                                    "agentid": c["agentid"],
                                    "mapped": len(c["map"]),
                                    "unmapped": c["unmapped"]})
        if path == "/api/info":
            with _lock:
                return self._json(200, {
                    "ok": True,
                    "name": "格丽思质量管理工作台共享服务",
                    "port": PORT,
                    "v": _state["v"],
                    "savedAt": _state["savedAt"],
                    "api": ["/api/ping", "/api/info", "/api/version", "/api/load", "/api/save",
                            "/api/wecom/status", "/api/wecom/send"],
                })
        # 其余交给静态文件（网页本身）
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]

        # 企业微信消息推送（工作台里流程流转会自动调它）
        if path == "/api/wecom/send":
            body = self._read_body()
            to = body.get("to") or ""
            text = body.get("text") or ""
            if not text:
                return self._json(400, {"ok": False, "error": "text 不能为空"})
            res = wecom_send(to, text, body.get("flowId") or "")
            print("  [企业微信] 推送「%s」→ %s" % (to, "成功" if res.get("ok") else res.get("reason")))
            return self._json(200, res)

        if path != "/api/save":
            return self._json(404, {"ok": False, "error": "unknown api"})

        body = self._read_body()
        data = body.get("data")
        base_v = body.get("v")
        if not isinstance(data, dict):
            return self._json(400, {"ok": False, "error": "data 必须是对象"})

        with _lock:
            # 乐观锁：客户端拿到的版本号必须与当前一致，否则说明有人先改过
            if base_v is not None and int(base_v) != _state["v"]:
                return self._json(409, {
                    "ok": False, "conflict": True,
                    "v": _state["v"], "savedAt": _state["savedAt"],
                    "data": _state["data"],
                })
            new_v = write_data(data)
            who = self.client_address[0]
            print("  [%s] %s 保存成功 → v%d" % (_now(), who, new_v))
            return self._json(200, {"ok": True, "v": new_v, "savedAt": _state["savedAt"]})

    # ---- 日志精简 ----
    def log_message(self, fmt, *args):
        msg = fmt % args
        if "/api/" in msg:
            return
        sys.stderr.write("  %s\n" % msg)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("223.5.5.5", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    print("=" * 62)
    print("  格丽思质量管理工作台 · 内网共享服务")
    print("=" * 62)
    load_data()

    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    ip = lan_ip()
    print("")
    print("  服务已启动，同事在浏览器里打开下面地址即可（手机电脑都行）：")
    print("")
    print("      http://%s:%d/" % (ip, PORT))
    print("")
    print("  本机自测：  http://127.0.0.1:%d/" % PORT)
    print("  数据文件：  %s" % DATA_FILE)
    print("  历史留档：  %s" % BACKUP_DIR)
    print("")
    print("  关闭这个窗口 = 停止服务。请让这台电脑保持开机、不要休眠。")
    print("")
    print("  想换端口：改 gls-server.ini 里的 port，或执行 python gls-server.py 9000")
    print("  接入方式（网页 / 小程序 / 换服务器）在工作台右下角齿轮里随时可改。")
    print("=" * 62)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止。")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()

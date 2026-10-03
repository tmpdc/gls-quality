# -*- coding: utf-8 -*-
"""双击配置企业微信推送：填三参数 + 姓名对照 + 测试 + 重启"""
import io
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:
    import msvcrt
    HAS_MSC = True
except ImportError:
    HAS_MSC = False

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, "gls-wecom.ini")


def say(*a):
    print(*a)
    sys.stdout.flush()


def clear():
    os.system("cls")


def pause(msg="\n按任意键继续..."):
    if HAS_MSC and sys.stdin.isatty():
        say(msg)
        msvcrt.getch()
    else:
        try:
            input(msg)
        except EOFError:
            pass


def ask(prompt, default=""):
    try:
        v = input(prompt).strip()
    except EOFError:
        v = ""
    return v if v else default


def port():
    ini = os.path.join(HERE, "gls-server.ini")
    if os.path.exists(ini):
        try:
            m = re.search(r"(?m)^[ \t]*port[ \t]*=[ \t]*(\d+)",
                          io.open(ini, "r", encoding="utf-8").read())
            if m:
                return int(m.group(1))
        except Exception:
            pass
    return 8686


PORT = port()


def parse_ini():
    """返回 {'app': {...}, 'map': {...}, 'option': {...}}"""
    out = {"app": {}, "map": {}, "option": {}}
    if not os.path.exists(INI):
        return out
    sec = None
    for ln in io.open(INI, "r", encoding="utf-8").read().replace("\r\n", "\n").split("\n"):
        s = ln.strip()
        if not s or s.startswith(";") or s.startswith("#"):
            continue
        if s.startswith("[") and s.endswith("]"):
            sec = s[1:-1].strip().lower()
            out.setdefault(sec, {})
            continue
        if "=" in s and sec:
            k, v = s.split("=", 1)
            out[sec][k.strip()] = v.strip()
    return out


def save_ini(cfg):
    """按标准结构重写整份 ini（保留说明注释）"""
    app, mp, opt = cfg["app"], cfg["map"], cfg["option"]
    lines = [
        "; ============================================================",
        "; 格丽思质量管理工作台 · 企业微信推送配置",
        "; ------------------------------------------------------------",
        "; 本文件由「设置企业微信推送.bat」自动生成，也可以手工改（改完必须重启服务）。",
        ";",
        "; 【app】三个参数从哪儿拿（企业微信管理后台 work.weixin.qq.com）：",
        ";   corpid   我的企业 -> 企业信息 -> 最下方「企业ID」",
        ";   secret   应用管理 -> 自建 -> 点开应用 -> Secret -> 点「查看」",
        ";            ★ 点完查看后，Secret 会发到【管理员的手机企业微信】里，去那儿复制",
        ";   agentid  同一个应用详情页上的「AgentId」，纯数字，例如 1000002",
        ";",
        "; 【map】姓名 = 企业微信账号（userid）",
        ";   userid 在：通讯录 -> 点开某个人 -> 「账号」那一栏",
        ";   左边写工作台里显示的姓名，右边写企业微信账号，一行一个：",
        ";       张三=zhangsan",
        ";       李四=lisi",
        ";   没在这里的人，按下面 unmapped 的规则处理。",
        ";",
        "; 【option】unmapped",
        ";   all  = 名单里没有的人，改成 @all 发给全公司（默认，不容易漏消息）",
        ";   skip = 名单里没有的人，直接不发",
        "; ============================================================",
        "",
        "[app]",
        "corpid = " + app.get("corpid", ""),
        "secret = " + app.get("secret", ""),
        "agentid = " + app.get("agentid", ""),
        "",
        "[map]",
    ]
    for k, v in mp.items():
        lines.append("%s=%s" % (k, v))
    lines += ["", "[option]", "unmapped = " + opt.get("unmapped", "all"), ""]
    io.open(INI, "w", encoding="utf-8", newline="").write("\n".join(lines).replace("\n", "\r\n"))


def running():
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % PORT, timeout=6) as r:
            return r.status == 200
    except Exception:
        return False


def restart():
    say("\n  正在重启服务 ...")
    subprocess.run(["powershell", "-NoProfile", "-Command",
                    "Get-NetTCPConnection -LocalPort %d -State Listen -ErrorAction SilentlyContinue | "
                    "ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" % PORT],
                   capture_output=True, timeout=40)
    time.sleep(2)
    srv = os.path.join(HERE, "gls-server.py")
    if not os.path.exists(srv):
        say("  !! 找不到 gls-server.py，请手动双击「启动服务.bat」")
        return False
    subprocess.Popen([sys.executable, srv], cwd=HERE,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=0x00000008)
    for _ in range(20):
        time.sleep(1)
        if running():
            return True
    return False


def api(path, data=None):
    url = "http://127.0.0.1:%d%s" % (PORT, path)
    if data is None:
        req = urllib.request.Request(url)
    else:
        req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"),
                                     method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, {"raw": "HTTP %d" % e.code}
    except Exception as e:
        return None, {"error": "%s: %s" % (type(e).__name__, e)}


def test_send(to_name):
    say("\n  正在发送测试消息 ...")
    st, d = api("/api/wecom/send",
                {"to": to_name, "text": "【格丽思质量管理工作台】企业微信推送测试，收到即表示配置成功。",
                 "flowId": "selftest"})
    if st == 200 and d.get("ok"):
        say("  [成功] 消息已发出，去企业微信看看收到没有。")
        return True
    reason = d.get("reason", "")
    hint = {
        "not_configured": "三个参数还没填全，回去补上。",
        "token_failed": "corpid / secret 不对，或者 agentid 跟 secret 不是同一个应用。",
        "no_target": "要发给的那个人，既不在姓名对照表里，unmapped 又设成了 skip。",
        "send_failed": "企业微信拒绝了这条消息。常见原因：该员工不在这个应用的可见范围里。",
        "api_error": "企业微信接口返回了错误，把下面这段原文发我。",
    }.get(reason, "")
    say("  [失败] %s" % reason)
    say("         %s" % d.get("msg", ""))
    if hint:
        say("         怎么办：%s" % hint)
    return False


def show_status():
    cfg = parse_ini()
    app = cfg["app"]
    say("  当前配置：")
    say("    企业ID corpid   : %s" % (app.get("corpid") or "【空】"))
    say("    应用密钥 secret : %s" % (("已填，%d 位" % len(app["secret"])) if app.get("secret") else "【空】"))
    say("    应用ID agentid  : %s" % (app.get("agentid") or "【空】"))
    say("    姓名对照表      : %d 人" % len(cfg["map"]))
    say("    名单外的人      : %s" % ("@all 全公司" if cfg["option"].get("unmapped", "all") == "all" else "跳过不发"))
    if running():
        st, d = api("/api/wecom/status")
        say("    服务端自检      : %s" % ("已配置，就绪" if d.get("configured") else
                                          "还没配好 —— " + str(d.get("msg", ""))))
    else:
        say("    服务端自检      : 服务没在跑，请先双击「启动服务.bat」")


def main():
    clear()
    say("=" * 58)
    say("   格丽思质量管理工作台 · 设置企业微信推送")
    say("=" * 58)
    say("")
    show_status()
    say("")
    say("  " + "-" * 54)
    say("  1 = 填写 / 修改配置（三参数 + 姓名对照表）")
    say("  2 = 发一条测试消息（验证配好没有）")
    say("  3 = 只看当前状态")
    say("  0 = 退出")
    say("  " + "-" * 54)
    say("")

    c = ask("  请选择 [1/2/3/0]：", "3")

    if c == "1":
        cfg = parse_ini()
        app, mp, opt = cfg["app"], cfg["map"], cfg["option"]
        say("")
        say("  【三个参数】改哪个填哪个，直接回车 = 保持不变")
        say("")
        say("  ① 企业ID（corpid）")
        say("     后台路径：我的企业 -> 企业信息 -> 最下方「企业ID」")
        v = ask("     填 corpid：", app.get("corpid", ""))
        app["corpid"] = v
        say("")
        say("  ② 应用密钥（secret）")
        say("     后台路径：应用管理 -> 自建 -> 点开你的应用 -> Secret -> 点「查看」")
        say("     ★ 点完查看，Secret 会发到你手机的【企业微信】里，去那条消息里复制")
        v = ask("     填 secret：", app.get("secret", ""))
        app["secret"] = v
        say("")
        say("  ③ 应用ID（agentid，纯数字，例如 1000002）")
        say("     位置：跟 Secret 同一个页面，叫「AgentId」")
        v = ask("     填 agentid：", app.get("agentid", ""))
        app["agentid"] = v

        save_ini(cfg)
        say("\n  [已保存] 三个参数写进 gls-wecom.ini")

        say("")
        if ask("  现在填「姓名对照表」吗？（名单里没有的人会发给全公司）[Y/n]：", "y").lower() in ("", "y", "yes"):
            say("")
            say("  用法：左边工作台里的姓名，右边企业微信账号，一行一个。例如：")
            say("        张三=zhangsan")
            say("        李四=lisi")
            say("  （账号在：通讯录 -> 点开某个人 -> 「账号」那一栏）")
            say("  全部填完，最后空一行直接回车结束。")
            say("")
            cnt = 0
            while True:
                ln = ask("    第 %d 行（回车结束）：" % (cnt + 1))
                if not ln:
                    break
                ln = ln.replace("：", ":").replace("＝", "=")
                if "=" in ln:
                    k, v2 = ln.split("=", 1)
                    k, v2 = k.strip(), v2.strip()
                    if k and v2:
                        mp[k] = v2
                        cnt += 1
                    else:
                        say("      !! 这行缺名字或账号，跳过了")
                else:
                    say("      !! 没有等号，格式应该是 张三=zhangsan")
            if cnt:
                say("")
                if ask("  名单里没有的人怎么办？1=发给全公司 2=跳过不发 [1/2]：", "1") == "2":
                    opt["unmapped"] = "skip"
                else:
                    opt["unmapped"] = "all"
            save_ini(cfg)
            say("\n  [已保存] 共录入 %d 人" % len(mp))

        say("")
        if ask("  现在重启服务让它生效吗？[Y/n]：", "y").lower() in ("", "y", "yes"):
            if restart():
                say("  [成功] 服务已重启（端口 %d）" % PORT)
            else:
                say("  !! 重启没成功，请手动双击「启动服务.bat」")
        else:
            say("  记住：不重启的话，新配置不会生效。")

        say("")
        if ask("  顺手发一条测试消息吗？[Y/n]：", "y").lower() in ("", "y", "yes"):
            cfg = parse_ini()
            who = list(cfg["map"].keys())
            if who:
                say("  用对照表里的第一个人试：%s（想换人，重新跑一次选 2）" % who[0])
                test_send(who[0])
            else:
                say("  对照表是空的，那就直接试 @all（会发给全公司，注意）")
                if ask("  确定要发给全公司吗？[y/N]：", "n").lower() == "y":
                    test_send("")

    elif c == "2":
        cfg = parse_ini()
        who = list(cfg["map"].keys())
        say("")
        if who:
            say("  对照表里的人：%s" % "、".join(who[:15]))
            n = ask("  要发给谁？直接回车 = %s：" % who[0], who[0])
        else:
            say("  对照表是空的。直接回车 = 发给全公司（@all）")
            n = ask("  要发给谁？", "")
        test_send(n)

    else:
        say("\n  没有改动。")
        pause()
        return

    say("")
    pause("\n  按任意键关闭这个窗口...")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print("\n出错了：%s" % e)
        traceback.print_exc()
        pause()

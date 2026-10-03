# -*- coding: utf-8 -*-
"""双击设置访问口令：写 gls-auth.ini + 可选重启服务"""
import io
import os
import re
import subprocess
import sys
import time

try:
    import msvcrt
    HAS_MSC = True
except ImportError:
    HAS_MSC = False

HERE = os.path.dirname(os.path.abspath(__file__))
AUTH = os.path.join(HERE, "gls-auth.ini")


def say(*a):
    print(*a)
    sys.stdout.flush()


def clear():
    os.system("cls")


def pause(msg="\n按任意键继续..."):
    # 双击运行时 stdin 是控制台，用 getch 更贴近「按任意键」；
    # 被管道调用时 stdin 不是终端，改走 input，否则会卡死。
    if HAS_MSC and sys.stdin.isatty():
        say(msg)
        msvcrt.getch()
    else:
        try:
            input(msg)
        except EOFError:
            pass


def read_now():
    """读当前口令（空字符串 = 未开启）"""
    if not os.path.exists(AUTH):
        return ""
    try:
        t = io.open(AUTH, "r", encoding="utf-8").read()
    except Exception:
        return ""
    m = re.search(r"(?m)^[ \t]*password[ \t]*=[ \t]*(.*?)[ \t]*$", t)
    return m.group(1) if m else ""


def write_pwd(pwd):
    """把口令写进 ini，保留原有其它配置"""
    if os.path.exists(AUTH):
        t = io.open(AUTH, "r", encoding="utf-8").read().replace("\r\n", "\n")
    else:
        t = "[auth]\npassword =\nexpire_hours = 12\n"
    if re.search(r"(?m)^[ \t]*password[ \t]*=", t):
        t = re.sub(r"(?m)^[ \t]*password[ \t]*=.*$", "password = " + pwd, t)
    else:
        t = "[auth]\npassword = " + pwd + "\nexpire_hours = 12\n"
    if not re.search(r"(?m)^[ \t]*expire_hours[ \t]*=", t):
        t = t.rstrip("\n") + "\nexpire_hours = 12\n"
    io.open(AUTH, "w", encoding="utf-8", newline="").write(t.replace("\n", "\r\n"))


def port():
    ini = os.path.join(HERE, "gls-server.ini")
    if os.path.exists(ini):
        try:
            m = re.search(r"(?m)^[ \t]*port[ \t]*=[ \t]*(\d+)", io.open(ini, "r", encoding="utf-8").read())
            if m:
                return int(m.group(1))
        except Exception:
            pass
    return 8686


def running(p):
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-NetTCPConnection -LocalPort %d -State Listen -ErrorAction SilentlyContinue | "
             "Measure-Object).Count" % p],
            capture_output=True, text=True, timeout=25).stdout
        return out.strip().isdigit() and int(out.strip()) > 0
    except Exception:
        return False


def restart(p):
    say("\n正在重启服务 ...")
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-NetTCPConnection -LocalPort %d -State Listen -ErrorAction SilentlyContinue | "
         "ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" % p],
        capture_output=True, timeout=40)
    time.sleep(2)
    srv = os.path.join(HERE, "gls-server.py")
    if not os.path.exists(srv):
        say("!! 找不到 gls-server.py，没法自动启动，请自己双击「启动服务.bat」")
        return False
    subprocess.Popen([sys.executable, srv], cwd=HERE,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=0x00000008)
    for _ in range(20):
        time.sleep(1)
        if running(p):
            return True
    return False


def main():
    p = port()
    clear()
    say("=" * 52)
    say("   格丽思质量管理工作台 · 设置访问口令")
    say("=" * 52)
    say("")
    cur = read_now()
    if cur:
        say("  当前状态：【已开启】")
        say("     口令：%s" % ("*" * len(cur)))
    else:
        say("  当前状态：【未开启】—— 内网可直接用，外网千万别这样")
    say("")
    say("  " + "-" * 48)
    say("  1 = 设置新口令")
    say("  2 = 关闭口令（回到内网免密）")
    say("  3 = 只看当前状态，不改")
    say("  0 = 退出")
    say("  " + "-" * 48)
    say("")

    try:
        c = input("  请选择 [1/2/3/0]：").strip()
    except EOFError:
        c = "3"

    if c == "1":
        say("")
        say("  提示：别用 123456、公司名、电话这类。建议长一点、乱一点，")
        say("        例如 GLS-2026-pinzhi-8x7k")
        say("")
        try:
            a = input("  输入新口令：").strip()
        except EOFError:
            a = ""
        if not a:
            say("\n  !! 口令不能为空，已取消。")
            pause()
            return
        if len(a) < 6:
            say("\n  !! 口令太短（少于 6 位），已取消。")
            pause()
            return
        try:
            b = input("  再输一次确认：").strip()
        except EOFError:
            b = ""
        if a != b:
            say("\n  !! 两次输入不一样，已取消。")
            pause()
            return
        write_pwd(a)
        say("\n  [成功] 口令已写入 gls-auth.ini")
    elif c == "2":
        write_pwd("")
        say("\n  [成功] 口令已关闭，回到内网免密状态")
    else:
        say("\n  没有改动。")
        pause()
        return

    say("")
    try:
        r = input("  现在重启服务让它生效吗？[Y/n]：").strip().lower()
    except EOFError:
        r = "y"
    if r in ("", "y", "yes"):
        if restart(p):
            say("  [成功] 服务已重启，正在监听 %d 端口" % p)
            say("")
            say("  内网访问：http://本机IP:%d/" % p)
            say("  同事第一次打开时：右下角绿色齿轮 → 填口令 → 保存并重连")
        else:
            say("  !! 重启没成功，请手动双击「启动服务.bat」")
    else:
        say("  记住：不重启的话新口令不会生效。")

    say("")
    pause("\n  按任意键关闭这个窗口...")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\n出错了：%s" % e)
        pause()

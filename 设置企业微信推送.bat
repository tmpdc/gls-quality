@echo off
chcp 65001 >nul
title 设置企业微信推送 - 格丽思质量管理工作台
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
    echo.
    echo   没有找到 python，请先安装 Python 后重试。
    echo.
    pause
    exit /b 1
)

python "设置企业微信推送.py"

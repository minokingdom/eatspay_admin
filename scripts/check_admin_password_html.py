import urllib.request

html = urllib.request.urlopen("https://eatspay.kr/admin", timeout=15).read().decode("utf-8")
tokens = [
    "ADMIN_PW_MASK_CHAR",
    "realPassword",
    "keydown",
    "\u25cf",
    'type="password"',
]
for token in tokens:
    print(token, html.count(token))

start = html.index("function bindAdminPassword")
print(html[start:start + 700])

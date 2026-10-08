"""Build the site for GitHub Pages.

Downloads every artwork referenced in index.html from Wix's media server
(original resolution), saves an archive copy, makes 800px and 1600px WebP
versions, and switches the page to the local copies.
"""
import io, os, re, sys, urllib.request
from PIL import Image

SRC = "index.html"
OUT = "dist"
html = open(SRC, encoding="utf-8").read()

ids = set()
for m in re.finditer(r'(?:M\(\s*"|")((?:72bb0d_)?[0-9a-f]{32}~mv2[^"]*?\.(?:jpg|jpeg|png|gif|webp))"', html):
    i = m.group(1)
    ids.add(i if i.startswith("72bb0d_") else "72bb0d_" + i)

os.makedirs(f"{OUT}/img", exist_ok=True)
os.makedirs(f"{OUT}/originals", exist_ok=True)
fail = 0
for i in sorted(ids):
    base = re.sub(r"\.[a-z]+$", "", i, flags=re.I)
    try:
        req = urllib.request.Request(f"https://static.wixstatic.com/media/{i}", headers={"User-Agent": "Mozilla/5.0"})
        data = urllib.request.urlopen(req, timeout=60).read()
        open(f"{OUT}/originals/{i}", "wb").write(data)
        im = Image.open(io.BytesIO(data))
        im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
        for w in (800, 1600):
            c = im.copy()
            c.thumbnail((w, w * 2))
            c.save(f"{OUT}/img/{base}-{w}.webp", "WEBP", quality=84, method=6)
        print("ok", i)
    except Exception as e:
        fail += 1
        print("FAIL", i, e, file=sys.stderr)

print(f"{len(ids)} images, {fail} failed")
html = html.replace("const LOCAL_IMAGES = false;", "const LOCAL_IMAGES = true;")
open(f"{OUT}/index.html", "w", encoding="utf-8").write(html)
open(f"{OUT}/404.html", "w", encoding="utf-8").write(html)
if os.path.exists("CNAME"):
    open(f"{OUT}/CNAME", "w").write(open("CNAME").read())
if fail:
    sys.exit(1)

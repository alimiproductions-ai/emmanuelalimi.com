"""Construit le site pour GitHub Pages.

Les œuvres sont lues dans les dossiers oeuvres/<dossier>/ : le nom du fichier
donne l'ordre et le titre ("03 Baba Sali.jpg" -> 3e position, titre "Baba Sali" ;
"07.jpg" -> sans titre). Les séries affichées et leurs textes sont dans contenu.json.
Les images du site (logo, accueil, portrait...) sont dans site/.
Chaque image est convertie en WebP 800 px et 1600 px dans dist/img/.
"""
import io, json, os, re, shutil, sys, unicodedata
from PIL import Image, ImageOps

EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")
OUT = "dist"


def slug(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "image"


def title_of(stem):
    return re.sub(r"^\s*\d+[a-z]?\s*[-_.)]*\s*", "", stem).strip()


def natural(name):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", name)]


def convert(path, base):
    """Écrit base-800.webp et base-1600.webp, renvoie (largeur, hauteur) d'origine."""
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    size = im.size
    im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
    os.makedirs(os.path.dirname(f"{OUT}/{base}"), exist_ok=True)
    for w in (800, 1600):
        c = im.copy()
        c.thumbnail((w, w * 2))
        c.save(f"{OUT}/{base}-{w}.webp", "WEBP", quality=84, method=6)
    return size


def folder(name):
    d = os.path.join("oeuvres", name)
    if not os.path.isdir(d):
        return []
    works, used = [], set()
    for f in sorted(os.listdir(d), key=natural):
        if not f.lower().endswith(EXT) or f.startswith("."):
            continue
        stem = os.path.splitext(f)[0]
        s = slug(stem)
        while s in used:
            s += "-b"
        used.add(s)
        base = f"img/{slug(name)}/{s}"
        try:
            w, h = convert(os.path.join(d, f), base)
        except Exception as e:
            print("FAIL", d, f, e, file=sys.stderr)
            continue
        works.append([base, title_of(stem), w, h, f])
    print(name, len(works), "images")
    return works


if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

contenu = json.load(open("contenu.json", encoding="utf-8"))
galeries = {}
for name in sorted(os.listdir("oeuvres")) if os.path.isdir("oeuvres") else []:
    if os.path.isdir(os.path.join("oeuvres", name)):
        galeries[name] = folder(name)

series = []
for s in contenu.get("series", []):
    works = galeries.get(s["dossier"], [])
    if not works:
        continue
    cover = next((w[0] for w in works if w[4] == s.get("couverture")), works[0][0])
    series.append({
        "dossier": s["dossier"], "nom": s["nom"], "code": s.get("code", ""),
        "intro": s.get("intro", ""), "couverture": cover,
        "bannieres": [w[:4] for w in galeries.get(s.get("bannieres") or "", [])] or None,
        "works": [w[:4] for w in works],
    })

site = {}
if os.path.isdir("site"):
    for f in os.listdir("site"):
        if f.lower().endswith(EXT):
            stem = os.path.splitext(f)[0]
            base = f"img/site/{slug(stem)}"
            convert(os.path.join("site", f), base)
            site[stem] = base

data = {"series": series, "galeries": {k: [w[:4] for w in v] for k, v in galeries.items()}, "site": site}
html = open("index.html", encoding="utf-8").read()
html = html.replace("/*__DATA__*/null", json.dumps(data, ensure_ascii=False))
open(f"{OUT}/index.html", "w", encoding="utf-8").write(html)
open(f"{OUT}/404.html", "w", encoding="utf-8").write(html)
if os.path.exists("CNAME"):
    shutil.copy("CNAME", f"{OUT}/CNAME")
print(len(series), "séries,", sum(len(v) for v in galeries.values()), "images")

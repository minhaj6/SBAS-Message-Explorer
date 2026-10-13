import json, pathlib
here = pathlib.Path(__file__).parent
src = (here / "page.src.html").read_text()
dec = (here / "decoder.js").read_text()
sample = (here / "sample.ems").read_text()
out = src.replace("/*DECODER*/", dec).replace("/*SAMPLE*/", json.dumps(sample))
# page.src.html has no document skeleton; wrap it into a complete page
head = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
(here / "index.html").write_text(head + out.replace("</style>", "</style></head><body>", 1) + "</body></html>")

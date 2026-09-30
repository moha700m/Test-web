from pathlib import Path

p = Path('tests/api.test.mjs')
text = p.read_text()
old_once = '''  assert.equal(
    (await f.request("run", { id: c.id, plan: "quick" })).status,
    403,
  );'''
new_once = '''  const again = await f.request("run", { id: c.id, plan: "quick" });
  assert.equal(again.status, 200);
  await again.body.cancel();'''

# Restore the assertion that belongs to the failed-ownership test.
if new_once in text:
    text = text.replace(new_once, old_once, 1)

# Convert only the final single-use assertion after a successful run.
pos = text.rfind(old_once)
if pos < 0:
    raise SystemExit('final single-use assertion not found')
text = text[:pos] + new_once + text[pos + len(old_once):]
p.write_text(text)

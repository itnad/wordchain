import os, json, re
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
MODEL_ID = "gemini-3-flash-preview"

SYSTEM = (
    "You are a world-class senior developer. Follow these rules strictly:\n"
    "1. Only modify what the issue explicitly requests. Never touch other code.\n"
    "2. Never modify security-related code unless explicitly asked.\n"
    "3. Never delete or disable existing logic. Only additions allowed.\n"
    "4. No refactoring or optimization beyond the request scope.\n"
    "5. Output ONLY valid JSON. No other text.\n\n"
    "Response JSON:\n"
    "{\n"
    "  \"changes\": [{\"path\":\"...\",\"mode\":\"append|replace_block|full\","
    "\"content\":\"...\",\"anchor\":\"...\"}],\n"
    "  \"summary\": \"...\",\n"
    "  \"analysis\": \"...\"\n"
    "}\n\n"
    "Mode rules:\n"
    "- append: add content at end of file. Use for new functions/features.\n"
    "- replace_block: replace block starting at anchor line.\n"
    "- full: replace entire file. ONLY for files under 500 chars.\n"
    "- NEVER use full mode for files over 500 chars."
)

issue_title = os.environ["ISSUE_TITLE"]
issue_body  = os.environ.get("ISSUE_BODY", "")
issue_num   = os.environ["ISSUE_NUMBER"]

all_files = {}
with open("/tmp/file_list.txt") as f:
    paths = [p.strip() for p in f if p.strip()]

for path in paths:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            all_files[path] = fh.read()
    except:
        pass

issue_text = (issue_title + " " + issue_body).lower()
keywords   = re.findall(r'[\w\-.]+', issue_text)

def score_file(path):
    name = path.lower().replace("./", "")
    score = 0
    for kw in keywords:
        if len(kw) > 3 and kw in name:
            score += 10
    if name.endswith(".js"):   score += 3
    if name.endswith(".html"): score += 3
    if name.endswith(".py"):   score += 2
    if "node_modules" in name or ".min." in name: score -= 100
    return score

MAX_TOTAL, MAX_PER = 40000, 8000
scored   = sorted(all_files.items(), key=lambda x: score_file(x[0]), reverse=True)
selected = {}
total    = 0
for path, c in scored:
    trunc = c[:MAX_PER] + f"\n...({len(c)-MAX_PER} chars omitted)" if len(c) > MAX_PER else c
    if total + len(trunc) > MAX_TOTAL:
        print(f"Skipped (budget): {path}")
        continue
    selected[path] = trunc
    total += len(trunc)

print(f"Files: {len(selected)}/{len(all_files)}, Context: {total} chars")

ctx    = "\n".join(f'<file path="{p}">\n{c}\n</file>' for p, c in selected.items())
prompt = f"Issue #{issue_num}: {issue_title}\n{issue_body}\n\nContext:\n{ctx}"
print(f"Prompt length: {len(prompt)} chars")

try:
    resp = client.models.generate_content(
        model=MODEL_ID,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM,
            temperature=0.1,
            response_mime_type="application/json",
            max_output_tokens=16384
        )
    )

    raw = resp.parsed if resp.parsed else json.loads(resp.text)
    if isinstance(raw, list):
        result = {"changes": raw, "summary": "AI fix", "analysis": ""}
    elif isinstance(raw, dict):
        result = raw
    else:
        raise ValueError(f"Unexpected type: {type(raw)}")

    for change in result.get("changes", []):
        fp  = (change.get("path") or change.get("file_path") or
               change.get("filename") or change.get("file") or "")
        fc  = (change.get("content") or change.get("code") or
               change.get("file_content") or "")
        mode   = change.get("mode", "full").lower()
        anchor = change.get("anchor", "")

        if not fp:
            print("Warning: no path, skipping")
            continue

        fp = fp.lstrip("./")
        orig = ""
        try:
            with open(fp, "r", encoding="utf-8", errors="ignore") as fh:
                orig = fh.read()
        except:
            pass

        if mode == "append":
            final = orig.rstrip() + "\n\n" + fc
            print(f"[append] {fp}: +{len(fc)} chars")
        elif mode == "replace_block":
            if anchor and anchor in orig:
                final = orig.replace(anchor, fc, 1)
                print(f"[replace_block] {fp}: OK")
            else:
                print(f"Warning: anchor not found in {fp}, using append")
                final = orig.rstrip() + "\n\n" + fc
        else:
            if len(orig) > 500 and len(fc) < len(orig) * 0.5:
                print(f"Warning: {fp} full mode size issue, skipping")
                continue
            final = fc
            print(f"[full] {fp}: {len(orig)}->{len(final)} chars")

        os.makedirs(os.path.dirname(fp) or ".", exist_ok=True)
        with open(fp, "w", encoding="utf-8") as fh:
            fh.write(final)

    with open(os.environ["GITHUB_ENV"], "a") as ef:
        ef.write(f"COMMIT_MSG={result.get('summary', 'AI fix')}\n")
        clean = result.get("analysis", "").replace("\n", " ").replace("\r", "")
        ef.write(f"GEMINI_ANALYSIS={clean}\n")
        ef.write("ERROR_TYPE=none\n")

except Exception as e:
    err = str(e)
    with open(os.environ["GITHUB_ENV"], "a") as ef:
        ef.write("ERROR_TYPE=503\n" if "503" in err or "UNAVAILABLE" in err else "ERROR_TYPE=unknown\n")
    print(f"Error: {e}")
    raise e

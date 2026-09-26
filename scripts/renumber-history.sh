#!/usr/bin/env bash
# Renumber the version prefix of every commit message on the local branches,
# to v0.MINOR.PATCH - the table and the reasons are in docs/version-map.md.
#
#   scripts/renumber-history.sh
#
# What it does, in order, and stops at the first thing that fails:
#   1. Refuses to run with uncommitted or staged changes, or twice.
#   2. Backs up: a tag backup/pre-renumber/<branch> on every branch tip, and a
#      bundle of the whole repository next to it (../<repo>-pre-renumber-<time>.bundle).
#   3. Rewrites commit MESSAGES only, on all local branches: the old version
#      prefix is cut off and the new one put in front; every other byte of
#      the message stays. Trees, authors, committers and dates are untouched.
#   4. Verifies, commit by commit, that the rewritten history is the old one
#      with new messages: same trees, same authors and dates, same shape.
#   5. Says what to do about the remote. It never pushes.
#
# To undo: git checkout <branch> && git reset --hard backup/pre-renumber/<branch>
# (per branch), or restore from the bundle.

set -euo pipefail

die() { echo "renumber: $*" >&2; exit 1; }

TOP=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
cd "$TOP"

command -v perl >/dev/null || die "needs perl"
command -v python3 >/dev/null || die "needs python3 (for the verification)"
git diff --quiet || die "there are uncommitted changes - commit or stash them first"
git diff --cached --quiet || die "there are staged changes - commit or unstage them first"
[ -z "$(git for-each-ref refs/tags/backup/pre-renumber)" ] || die "backup/pre-renumber tags exist: it has already run (delete them to run again)"
[ -z "$(git for-each-ref refs/original)" ] || die "refs/original exists (an earlier filter-branch): check it and delete it first"

BRANCHES=$(git for-each-ref --format='%(refname:short)' refs/heads)
STAMP=$(date +%Y%m%d-%H%M%S)

# --- the map: commit, old prefix (exact bytes, cut from the start), new prefix, text to cut inside
MAP=$(mktemp)
trap 'rm -f "$MAP"' EXIT
cat > "$MAP" <<'MAP'
8692d6b5bff2ade5a888dd3af6f330f97d9f2e19		v0.1: 	v1.1: 
1319f2c8e2faf16e92bf5fc245c7d827be886c2a	v1.2 	v0.2: 	
3187004bf01c3d9a3f93827514d4c41a804ce732	v1.3 	v0.3: 	
296a72b269aacb91f1f24f12a6d9b5b4d5817238	v1.4 	v0.4: 	
76a58e0f78579b18e5fc73eac4d23c284cd5a74f	v1.4.1 	v0.5: 	
78c808aa846d4117a6267959bbfa5e70cc37c59f	v1.5 	v0.6: 	
a8ce59a6201693c917c21634417193cdfcb22cc9	v1.5.1 	v0.7: 	
2abbfd62fd8391d5fc575dd4ff597dbf65a8ed23	v1.6 	v0.8: 	
e9a9ddf607caf7d80a4bfe9aa3aedc058af83018	v1.7 	v0.9: 	
60f441eb0488a1da770290e8c051f70662c1466a	v1.8 	v0.10: 	
82f00f64f1e97ba133585402770231a2ca5a3b13	1.8.1 	v0.11: 	
a3bdf7be2d2d9db2d068db0a971a11fb018b83dd	v2.1 	v0.12: 	
19d5f43a44d00b18fcf045b9bd920e77f83e1626	v2.2 	v0.13: 	
06f8075cea57ebbc4c56710865851a2bb72a5cea	v2.4 	v0.14: 	
3b5ddd662a88afc00191a83c6d16f2e7fe82d76d	v3 	v0.15: 	
a3b8fe0862d79cec26064a1df336427ed1c1d7a9	v4 	v0.16: 	
9004b8c9063ecda20202833dd9e17fd1699e1825	v5 	v0.17: 	
df99057e4b4ca6ddfe150c0402a68ec23f35ff09	v5 	v0.17.1: 	
3e3e3581399a419e5f554a91b2cada85f1d5dab1	v5.1 	v0.17.2: 	
71e0df342e67b92e542ba3e8c2f1721250148892	v5.2.1 	v0.18: 	
2fa4f79f9c5cc79f3733dfec615ccc0ddc43fb73	v5.3 	v0.19: 	
2a931fad06aa9f44e85a17775caf94db9b94d658	v6 	v0.20: 	
6a43aef27323797ee906f24e992e2bb2ad5da45d	v6.1 	v0.21: 	
2cbf6a6843896cae00291fe4b735cbffb6053458	v7 	v0.22: 	
9bf8ca9659514738aa98144ccad62c510091e349	v7.1 	v0.23: 	
9d15db87303d6402e8135bc5e9afc043a019f752	v7.2 	v0.24: 	
a9fe5d2ee418038d332ae5af6e2721247872a01c	v7.2 	v0.25: 	
b9b6779a0bcbd8ed29272e6f980c251f37fcaf0e	v8 	v0.26: 	
e51e327e306ea38fcf8792a455188bdd8369fbf4	v9 	v0.27: 	
8f48694a28e3a7d164c4b99a7dc228404c78af99	v9.1 	v0.27.1: 	
ad73a3c3655e334128b003c9d50cd1eb7007837e	v9.2 	v0.28: 	
abfe9303bf0bb905704443b235c127b74e7ad1ec		v0.28.1: 	
e209e9363128ec8d24a91bddde3e85adf3b392f7		v0.28.2: 	
5dae7dcd69aa5f054df2550ab11c887c885a1a77	v9.3 	v0.28.3: 	
0207608be74143df6a4b98997791a786e9522dc1		v0.28.4: 	
8de7e1c16fa26ee54565d8263a24041db575ec26	v9.4 	v0.29: 	
903af7ff0017f1dc9fcbef9ebeaf12a01f7dfa3f	v9.5 	v0.30: 	
428e40544ab787ee62231eca4554a63f7389f9d9	v9.5 	v0.30.1: 	
89c20363c38761bae99397b560647f85229a7fd4	v9.5.1 	v0.30.2: 	
055865ec04c36de0d5165e845326f38e93aec101	v9.6 	v0.30.3: 	
bbcb0d40829a20de995b41c57ef594ffcde8b043	v9.6.1 	v0.30.4: 	
d7a4b3ed97c1349fb4e6f6c75278a800af1ea68e	v9.7 	v0.30.5: 	
9192981bbebaa2986857491959da54aacbfa96d3	v10 	v0.31: 	
0bb0f78eda78bd806e425c79721823a9441c213d	v10.1 	v0.31.1: 	
345892e0ca0f6b357039809641427ca3eb878c41	v10.1.1 	v0.31.2: 	
1cf2b33da4e84a99798499d4ee931139975aac75	v11 	v0.32: 	
2f8c97cb6e815ce02770e6a091f66a56432fd3b6	v11.1 	v0.32.1: 	
6b54bfede3d4f7a2ea7fc4a6b01704144bb706cb		v0.33: 	
175f55ea7771f6d859eec449e8f7f746546f0da6	v0.12: 	v0.33.1: 	
45360d039ca96522240d8c843eca5ca91406358e	v0.12.1 	v0.33.2: 	
b51b8e69b99cef7036f02bc35e4c0d7392593d40	v0.12.2 	v0.34: 	
97827cb5649c9512eda67c003c1deeb3be2a9a85	v0.12.3 	v0.34.1: 	
2a1594574b851ca710a1d3d61d7efc662bab152e	v0.12.4 	v0.34.2: 	
d0077c5988546cc977be204a59dac5c040798b77	v0.12.5 	v0.34.3: 	
MAP

while IFS=$'\t' read -r hash _; do
  git cat-file -e "$hash^{commit}" 2>/dev/null || die "commit $hash from the map is not in this repository"
done < "$MAP"

# --- 1. backup
echo "Backing up:"
for b in $BRANCHES; do
  git tag "backup/pre-renumber/$b" "refs/heads/$b"
  echo "  tag backup/pre-renumber/$b -> $(git rev-parse --short "refs/heads/$b")"
done
BUNDLE="$(cd .. && pwd)/$(basename "$PWD")-pre-renumber-$STAMP.bundle"
git bundle create "$BUNDLE" --all >/dev/null 2>&1
git bundle verify "$BUNDLE" >/dev/null 2>&1 || die "the bundle did not verify"
echo "  bundle $BUNDLE"

# --- 2. rewrite the messages
echo "Rewriting messages on: $(echo $BRANCHES)"
export RENUMBER_MAP="$MAP"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --msg-filter '
  entry=$(grep "^$GIT_COMMIT	" "$RENUMBER_MAP" || true)
  if [ -z "$entry" ]; then
    cat
  else
    OLD=$(printf "%s" "$entry" | cut -f2) NEW=$(printf "%s" "$entry" | cut -f3) INSIDE=$(printf "%s" "$entry" | cut -f4) \
    perl -0777 -pe '"'"'
      my ($o, $n, $i) = @ENV{qw(OLD NEW INSIDE)};
      if (length $o) { die "old prefix not at the start\n" unless substr($_, 0, length $o) eq $o; substr($_, 0, length $o) = ""; }
      if (length $i) { my $p = index($_, $i); die "text to cut not found\n" if $p < 0; substr($_, $p, length $i) = ""; }
      $_ = $n . $_;
    '"'"'
  fi
' -- --branches >/dev/null

# --- 3. verify
echo "Verifying:"
python3 - "$MAP" $BRANCHES <<'PY'
import subprocess, sys
mapfile, branches = sys.argv[1], sys.argv[2:]
rules = {}
for line in open(mapfile, encoding='utf-8'):
    h, old, new, inside = line.rstrip('\n').split('\t')
    rules[h] = (old, new, inside)

def git(*a):
    return subprocess.run(['git', *a], check=True, capture_output=True).stdout

def commits(ref):
    out = git('rev-list', '--topo-order', '--reverse', '--date-order', ref).decode().split()
    return out

def info(c):
    raw = git('cat-file', 'commit', c)
    head, _, msg = raw.partition(b'\n\n')
    fields = {'parents': []}
    for line in head.split(b'\n'):
        k, _, v = line.partition(b' ')
        if k == b'parent': fields['parents'].append(v.decode())
        else: fields[k.decode()] = v
    return fields, msg

def expected(old_hash, msg):
    if old_hash not in rules: return msg
    old, new, inside = (x.encode() for x in rules[old_hash])
    assert msg.startswith(old)
    msg = msg[len(old):]
    if inside:
        i = msg.index(inside); msg = msg[:i] + msg[i + len(inside):]
    return new + msg

bad = 0
mapping = {}
for b in branches:
    old_ref = f'refs/original/refs/heads/{b}'
    try: old_list = commits(old_ref)
    except subprocess.CalledProcessError:
        print(f'  {b}: not rewritten (nothing to change)'); continue
    new_list = commits(f'refs/heads/{b}')
    if len(old_list) != len(new_list):
        print(f'  {b}: FAILED - {len(old_list)} commits before, {len(new_list)} after'); bad += 1; continue
    renamed = 0
    for o, n in zip(old_list, new_list):
        (fo, mo), (fn, mn) = info(o), info(n)
        problems = [k for k in ('tree', 'author', 'committer') if fo.get(k) != fn.get(k)]
        if [mapping.get(p, p) for p in fo['parents']] != fn['parents']: problems.append('parents')
        if mn != expected(o, mo): problems.append('message')
        if problems:
            print(f'  {b}: FAILED at {o[:7]} -> {n[:7]}: {", ".join(problems)} differ'); bad += 1; break
        mapping[o] = n
        renamed += mn != mo
    else:
        print(f'  {b}: {len(new_list)} commits, {renamed} messages renumbered; trees, authors, committers, dates and shape identical')
sys.exit(1 if bad else 0)
PY
echo "All branches verified. The old history is still in refs/original/ and the backup tags;"
echo "once you are happy:  git for-each-ref --format='%(refname)' refs/original | xargs -n1 git update-ref -d"

# --- 4. the remote
if [ -n "$(git remote)" ]; then
  echo
  echo "Remotes: $(git remote | tr '\n' ' ')- NOT pushed. Every rewritten commit has a new hash, so the"
  echo "remote's history no longer matches yours. To publish the new messages (this replaces the"
  echo "history on the remote; anyone else with a clone must re-clone or hard-reset):"
  for b in $BRANCHES; do
    up=$(git rev-parse --abbrev-ref "$b@{upstream}" 2>/dev/null || true)
    [ -n "$up" ] && echo "  git push --force-with-lease=${up#*/}:$(git rev-parse --short "backup/pre-renumber/$b") ${up%%/*} $b:${up#*/}"
  done
  echo "Branches without an upstream were never pushed and need nothing."
fi

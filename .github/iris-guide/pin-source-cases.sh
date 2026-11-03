#!/usr/bin/env bash
# The guide's macOS pin-source step (pin-source.sh, the verbatim command with
# its pin replaced by 40 zeros) on old clones of this repository, in /bin/sh
# and in zsh (Iris for Mac types every step into one zsh). The same cases as
# pin-source-cases.ps1: every clone is a clone of main only at 71ee482, as
# guide v15 left it, so it has no copy of the commit under test; the pin is
# this commit ($GITHUB_SHA), fetched from GitHub by its sha.
# Usage: pin-source-cases.sh <shell>   Exit 1 on any failure.
set -u
shell="$1"
old_pin=71ee482dae4a2c7f592103eb977248bc70ba4923
here="$(cd "$(dirname "$0")" && pwd)"
dir="${RUNNER_TEMP:-/tmp}/pin-$(basename "$shell")"
rm -rf "$dir" && mkdir -p "$dir"
zeros=0000000000000000000000000000000000000000
grep -qx "git checkout $zeros" "$here/pin-source.sh" || { echo 'pin-source.sh has no git checkout of the zero pin'; exit 1; }
command="$(sed "s/$zeros/$GITHUB_SHA/g" "$here/pin-source.sh")"
fail=0

new_clone() {
  git clone --quiet --single-branch --branch main https://github.com/Blueturboguy07/nut-ai.git "$dir/$1"
  git -C "$dir/$1" checkout --quiet "$old_pin"
  if git -C "$dir/$1" cat-file -e "$GITHUB_SHA" 2>/dev/null; then echo "the old clone already has $GITHUB_SHA"; exit 1; fi
}
pin() { # <case> [env...]
  local name="$1"; shift
  (cd "$dir/$name" && env "$@" "$shell" -c "$command") > "$dir/$name.log" 2>&1
  code=$?
  head_now="$(git -C "$dir/$name" rev-parse HEAD)"
  stashes="$(git -C "$dir/$name" stash list | wc -l | tr -d ' ')"
  tree="$(git -C "$dir/$name" status --porcelain | sed 's/^ *//' | paste -sd '|' -)"
}
check() { # <case> <what> <test...>
  local name="$1" what="$2"; shift 2
  if "$@"; then mark=ok; else mark=FAIL; fail=1; fi
  echo "$shell $name - $what: $mark"
  echo "| $shell | $name | $what | $mark |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
}

new_clone clean
pin clean
check clean "exit 0 (got $code)" test "$code" = 0
check clean 'HEAD is the pin' test "$head_now" = "$GITHUB_SHA"
check clean 'nothing stashed' test "$stashes" = 0

new_clone changed
printf '\nmy notes\n' >> "$dir/changed/README.md"
echo mine > "$dir/changed/my-notes.txt"
mkdir -p "$dir/changed/node_modules/x" && echo 1 > "$dir/changed/node_modules/x/index.js"
pin changed
check changed "exit 0 (got $code)" test "$code" = 0
check changed 'HEAD is the pin' test "$head_now" = "$GITHUB_SHA"
check changed "one stash (got $stashes)" test "$stashes" = 1
check changed "clean tree after (got '$tree')" test -z "$tree"
check changed 'says the changes are saved' grep -q 'Your changes in ~/nut-ai are saved with git stash' "$dir/changed.log"
stashed="$(git -C "$dir/changed" stash show --include-untracked --name-only 'stash@{0}' | LC_ALL=C sort | paste -sd ',' -)"
check changed "the stash holds README.md and my-notes.txt (got $stashed)" test "$stashed" = 'README.md,my-notes.txt'
check changed 'ignored files stay' test -f "$dir/changed/node_modules/x/index.js"

new_clone diverged
git -C "$dir/diverged" checkout --quiet main
echo 'local work' > "$dir/diverged/mine.txt"
git -C "$dir/diverged" add -A
git -C "$dir/diverged" -c user.name=ci -c user.email=ci@localhost commit --quiet -m 'local work'
local_main="$(git -C "$dir/diverged" rev-parse main)"
pin diverged
check diverged "exit 0 (got $code)" test "$code" = 0
check diverged 'HEAD is the pin' test "$head_now" = "$GITHUB_SHA"
check diverged 'main keeps the local commit' test "$(git -C "$dir/diverged" rev-parse main)" = "$local_main"

new_clone ssh
git -C "$dir/ssh" remote set-url origin git@github.com:Blueturboguy07/nut-ai.git
pin ssh
check ssh "exit 0 (got $code)" test "$code" = 0
check ssh 'HEAD is the pin' test "$head_now" = "$GITHUB_SHA"

new_clone other
git -C "$dir/other" remote set-url origin https://github.com/someone-else/nut-ai.git
printf '\nmine\n' >> "$dir/other/README.md"
pin other
check other "exit not 0 (got $code)" test "$code" != 0
check other 'HEAD unchanged' test "$head_now" = "$old_pin"
check other 'nothing stashed' test "$stashes" = 0
check other 'says the folder is not this app' grep -q 'is not a copy of this app' "$dir/other.log"

new_clone offline
printf '\nmine\n' >> "$dir/offline/README.md"
pin offline HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9
check offline "exit not 0 (got $code)" test "$code" != 0
check offline 'HEAD unchanged' test "$head_now" = "$old_pin"
check offline 'nothing stashed' test "$stashes" = 0
check offline "the edit is still in the tree (got '$tree')" test "$tree" = 'M README.md'
check offline 'says the download failed' grep -q 'Could not download the reviewed version' "$dir/offline.log"

pin clean
check 'clean again' "exit 0 (got $code)" test "$code" = 0
check 'clean again' 'nothing stashed' test "$stashes" = 0

# The shell must survive the step: `exit` only ever runs inside its ( ).
out="$(cd "$dir/other" && "$shell" -c "$command
echo still-here" 2>&1)"
check 'shell survives' 'the shell runs the next line' grep -q still-here <<< "$out"

[ "$fail" = 0 ] || { echo "$shell: a check failed"; exit 1; }
echo "$shell: every old-clone case passed"

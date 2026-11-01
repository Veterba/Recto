#!/bin/sh
# PreToolUse hook for read-only subagents: lets a Bash command through only when
# every part of it starts with a read-only command and nothing is written to a file.
# Exit 2 blocks the command; the message on stderr goes back to the agent.

command=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')

block() {
  echo "Blocked: this agent's Bash is read-only ($1)." >&2
  exit 2
}

# Redirection to a file (2>&1 and >/dev/null are fine).
stripped=$(printf '%s' "$command" | sed -E 's/[0-9]?>&[0-9]//g; s/[0-9]?>[[:space:]]*\/dev\/null//g')
case "$stripped" in
  *'>'*) block "writes to a file" ;;
  *'$('*|*'`'*) block "command substitution" ;;
esac

# Each part of a pipeline or command list.
printf '%s\n' "$command" | sed -E 's/(\|\||&&|;|\|)/\n/g' | while IFS= read -r part; do
  part=$(printf '%s' "$part" | sed -E 's/^[[:space:]]*(cd [^[:space:]]+[[:space:]]*)?//')
  [ -z "$part" ] && continue
  first=$(printf '%s' "$part" | awk '{print $1}')
  second=$(printf '%s' "$part" | awk '{print $2}')
  case "$first" in
    ls|cat|head|tail|wc|grep|rg|file|stat|du|pwd|echo|printf|sort|uniq|cut|tr|diff|tree|which|jq|basename|dirname|realpath|true) ;;
    find) case "$part" in *-delete*|*-exec*|*-execdir*|*-ok*) block "find with -delete/-exec" ;; esac ;;
    sed) case "$part" in *' -i'*) block "sed -i" ;; esac ;;
    git) case "$second" in log|diff|show|status|blame|grep|ls-files|rev-parse|branch|shortlog|cat-file) ;; *) block "git $second" ;; esac ;;
    npm) case "$second" in ls|view|explain) ;; *) block "npm $second" ;; esac ;;
    *) block "$first" ;;
  esac
done || exit 2
exit 0

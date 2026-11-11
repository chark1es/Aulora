#!/bin/bash
printf '%s\n' "$*" >> "$CALLS"
case "$*" in
  'compose version --short')
    if [ "$NO_COMPOSE" = true ]; then echo "docker: 'compose' is not a docker command." >&2; exit 1; fi
    echo "${COMPOSE_VERSION:-2.24.6}" ;;
  'compose config --images convex-backend') printf '%b\n' "${ENGINE_IMAGES:-engine:pinned}" ;;
  'image inspect --format {{.Id}} engine:pinned') echo sha256:target ;;
  'compose ps -a -q convex-backend') if [ "$MISSING_ENGINE" != true ]; then echo engine-container; fi ;;
  'inspect --format {{.Image}} engine-container') echo "$RUNNING_IMAGE" ;;
esac
if [[ "$*" == 'compose run --rm setup' && "$FAIL_HEALTH" == setup ]]; then exit 1; fi
if [[ "$*" == *--wait* ]]; then
  if [[ "$FAIL_HEALTH" == engine || ( "$FAIL_HEALTH" == web && "$*" == *web ) ]]; then exit 1; fi
fi

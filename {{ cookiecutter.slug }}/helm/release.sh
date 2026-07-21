#!/bin/bash

# Exit if any of the intermediate steps fail
set -e

source ${BITBUCKET_CLONE_DIR:-.}/profile.sh

# Remove all ephemeral build files, including downloaded
# dependency charts and lock file
function helm_clean() {
    rm -rf "./*/charts/" "./*/tmpcharts*/" "./*/Chart.lock"
}

function helm_login() {
  gcloud auth application-default print-access-token \
  | helm registry login \
    "https://${GOOGLE_DOCKER_REGISTRY}" \
    -u oauth2accesstoken \
    --password-stdin
}

# Add GODEBUG=http2client=0 to address the helm bug:
# https://github.com/helm/helm/issues/11415.
# https://github.com/helm/helm/issues/11415
function helm_build() {
  GODEBUG=http2client=0 helm dep build .
  GODEBUG=http2client=0 helm lint . --with-subcharts
  GODEBUG=http2client=0 helm package .

}

# Push the chart to the registry
function helm_release() {
  HELM_CHART=$(yq  '(.name + "-" + .version + ".tgz")' Chart.yaml)
  GODEBUG=http2client=0 helm push $HELM_CHART $HELM_REGISTRY_URL
}


if [ $CI ]; then
  cd "${BITBUCKET_CLONE_DIR}/helm"
  helm_login
  helm_build
  helm_release
  cd $BITBUCKET_CLONE_DIR
fi


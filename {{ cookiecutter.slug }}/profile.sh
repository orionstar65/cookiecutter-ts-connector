#!/bin/bash

# Exit if any of the intermediate steps fail
set -e

export APP_NAME=$(npm run get:name --silent)
export APP_VERSION=$(npm run get:semver --silent)
export APP_HOME_PAGE=$(npm run get:home --silent)

echo "---"
echo "appVersion: $APP_VERSION"
echo "appName: $APP_NAME"
echo "appHomePage: $APP_HOME_PAGE"
echo "---"


check_return() {
    retval=$?
    if [ $retval -ne 0 ]; then
        echo "Error: $retval"
        exit $retval
    fi
}


# ! Configure any secret environment variables here
bitbucket_secrets() {
    mkdir -p "/var/secrets/gcloud/helm-sa"

    # gcloud CLI credentials
    echo "${SA_HELM_GCLOUD_API_KEYFILE}" |
        base64 --decode > "/var/secrets/gcloud/helm-sa/credentials.json"

    export GOOGLE_APPLICATION_CREDENTIALS="/var/secrets/gcloud/helm-sa/credentials.json"

    # list secrets
    ls -R /var/secrets
}


# gcloud Variables / Login
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
export CLOUDSDK_CORE_PROJECT="${GCLOUD_PROJECT:-my-gcp-project}"
export GOOGLE_DOCKER_REGISTRY="${GOOGLE_DOCKER_REGISTRY:-ghcr.io}"

# Docker Variables
export DOCKER_BUILDKIT=0
export DOCKER_REGISTRY_HOST="${GOOGLE_DOCKER_REGISTRY}"
export DOCKER_REGISTRY_PORT=5443

# Helm variables
export HELM_REGISTRY="helm-charts"
export HELM_REGISTRY_URL="oci://${GOOGLE_DOCKER_REGISTRY}/${CLOUDSDK_CORE_PROJECT}/${HELM_REGISTRY}"

# TODO: Support multiple image builds.
#
#   Probably best to create a `pipeline.sh` file that `source` imports the rest
#   of the pipeline step code and loops over variables. (Keeps it decoupled from
#   the implementation of the steps.)
#
if [ $CI ]; then
    export PATH="/usr/bin:$PATH"
    export DOCKER_REGISTRY="${DOCKER_REGISTRY_HOST}"
    export DOCKER_REPOSITORY="${DOCKER_REGISTRY}/${CLOUDSDK_CORE_PROJECT}/apps/${BITBUCKET_REPO_SLUG}"
    export DOCKER_IMAGE="${DOCKER_REPOSITORY}:pipeline-${BITBUCKET_BUILD_NUMBER}"

    bitbucket_secrets
    gcloud auth activate-service-account --key-file="${GOOGLE_APPLICATION_CREDENTIALS}"
    gcloud auth configure-docker "${GOOGLE_DOCKER_REGISTRY}"
fi

# Read more about the variables that are accessible in Bitbucket Pipelines
# during $CI.
#
#    https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/
#
export check_return

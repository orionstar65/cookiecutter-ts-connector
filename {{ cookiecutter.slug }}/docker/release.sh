#!/bin/bash

# Exit if any of the intermediate steps fail
set -e

source ${BITBUCKET_CLONE_DIR:-.}/profile.sh


bitbucket_build() {
    # Bitbucket build
    docker build ${BITBUCKET_CLONE_DIR}                         \
        --tag $DOCKER_IMAGE                                     \
        --platform linux/amd64                                  \
        --label build_at="$(date -u)"                           \
        --label build_by=bitbucket                              \
        --label build_image="${DOCKER_IMAGE}"                   \
        --label build_tag="${BITBUCKET_TAG}"                    \
        --label git_branch="${BITBUCKET_BRANCH}"                \
        --label git_commit="${BITBUCKET_COMMIT}"                \
        --label git_project="${BITBUCKET_PROJECT_KEY}"          \
        --label git_repo="${BITBUCKET_REPO_FULL_NAME}"          \
        --label git_repo_slug="${BITBUCKET_SLUG}"               \
        --build-arg NPM_TOKEN=$(gcloud auth print-access-token)

    check_return
}

bitbucket_release() {
    # ALWAYS push the pipeline tag (e.g. `pipeline-1234`)
    docker push ${DOCKER_IMAGE}
    check_return

    # Additional tagging
    # ALWAYS push release branch tagging, (e.g. 1.0.1-main.1234)
    if [ "${BITBUCKET_BRANCH}" ]; then
        tag="${DOCKER_REPOSITORY}:${APP_VERSION}-${BITBUCKET_BRANCH}.${BITBUCKET_BUILD_NUMBER}"
        gcloud artifacts docker tags add "${DOCKER_IMAGE}" "${tag}"
        check_return
    fi

    # SOMETIMES "main" releases "latest"
    # as a direct result of a `merge` to `main`
    if [ "${BITBUCKET_BRANCH}" == "main" ]; then
        tag="${DOCKER_REPOSITORY}:latest"
        gcloud artifacts docker tags add "${DOCKER_IMAGE}" "${tag}"
        check_return

    # SOMETIMES "git tag" releases the version as a tag, (e.g. 1.0.1)
    # The direct result of a `git push --tags`
    elif [ "${BITBUCKET_TAG}" ]; then
        if [ "${BITBUCKET_TAG}" != "v${APP_VERSION}" ]; then
            echo
            echo "TagMismatchError"
            echo "  appVersion: ${APP_VERSION}"
            echo "  tag: ${BITBUCKET_TAG}"
            echo
            exit 1;
        fi

        tag="${DOCKER_REPOSITORY}:${APP_VERSION}"
        gcloud artifacts docker tags add "${DOCKER_IMAGE}" "${tag}"
        check_return
    fi

}

if [ $CI ]; then
    bitbucket_build
    bitbucket_release
fi

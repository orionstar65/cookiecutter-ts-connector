ARG NODE_VERSION="22"

FROM node:${NODE_VERSION} AS node

ARG NPM_TOKEN

# Construct the filesystem
WORKDIR /app
COPY . .

# Install from package.json
USER root

RUN if [ -n "${NPM_TOKEN}" ]; then echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> .npmrc; fi
RUN npm install
RUN npm run build
RUN rm -f .npmrc

# Run node server
USER node
ENTRYPOINT [ "npm" ]
CMD [ "run", "start" ]

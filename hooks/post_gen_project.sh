#! /bin/bash

# Optional: create an empty GitHub repository, then push.
# gh repo create {{ cookiecutter.username }}/{{ cookiecutter.slug }} --private --source=. --remote=origin

# Create a git repository in the local package directory.
git init

# Install using public npm + vendored file: packages under ./packages
npm install

# Initial commit
git add .
git commit -am "Generated from gh:orionstar65/cookiecutter-typescript-connector"

# Optional: push to GitHub
# git remote add origin git@github.com:{{ cookiecutter.username }}/{{ cookiecutter.slug }}.git
# git push -u origin main

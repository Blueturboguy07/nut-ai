(
if ! git config --get remote.origin.url 2>/dev/null | sed -E 's#^git@github\.com:#https://github.com/#; s#\.git$##' | grep -qxF "https://github.com/Blueturboguy07/nut-ai"; then
  echo "~/nut-ai already exists and is not a copy of this app's source. Move or rename that folder, then press Try again."
  exit 1
fi
if ! git cat-file -e 0000000000000000000000000000000000000000 2>/dev/null && ! git fetch --no-tags https://github.com/Blueturboguy07/nut-ai.git 0000000000000000000000000000000000000000; then
  echo "Could not download the reviewed version. Check your internet connection, then press Try again."
  exit 1
fi
if git status --porcelain 2>/dev/null | grep -q .; then
  git -c user.name=iris-guide -c user.email=iris-guide@localhost stash push --include-untracked -m "Saved by the install guide" || exit 1
  echo "Your changes in ~/nut-ai are saved with git stash. To see them: git stash list"
fi
git checkout 0000000000000000000000000000000000000000
)
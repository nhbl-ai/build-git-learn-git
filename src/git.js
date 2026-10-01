/** A commit in the in-memory Git model. */
export class Commit {
  constructor(id, parent, message) {
    // TODO: Store the commit's id, parent and message.
    throw new Error('TODO: Implement Commit');
  }
}

/** A named pointer to a commit. */
export class Branch {
  constructor(name, commit) {
    // TODO: Store the branch's name and current commit.
    throw new Error('TODO: Implement Branch');
  }
}

/** An educational Git model to implement while following the article. */
export class Git {
  constructor(name) {
    // TODO: Initialize the repository name and its starting state.
    // Add commit IDs, branches and HEAD as you progress through the article.
    throw new Error('TODO: Implement Git initialization');
  }

  commit(message) {
    // TODO: Create a commit linked to its parent and update the current pointer.
    throw new Error('TODO: Implement commit');
  }

  log() {
    // TODO: Return the current history, newest commit first.
    throw new Error('TODO: Implement log');
  }

  checkout(branchName) {
    // TODO: Switch to an existing branch, or create one at the current commit.
    throw new Error('TODO: Implement checkout');
  }
}

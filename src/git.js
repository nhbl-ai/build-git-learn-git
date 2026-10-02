/** A commit in the in-memory Git model. */
export class Commit {
  constructor(id, parent, message) {
    this.id = id;
    this.parent = parent;
    this.message = message;
  }
}

/** A named pointer to a commit. */
export class Branch {
  constructor(name, commit) {
    this.name = name;
    this.commit = commit;
  }
}

/** An educational Git model to implement while following the article. */
export class Git {
  constructor(name) {
    this.name = name;
    this.lastCommitId = 0;

    const initialBranch = new Branch('master', null);

    this.branches = [initialBranch];
    this.HEAD = initialBranch;
  }

  commit(message) {
    const newCommit = new Commit(
      ++this.lastCommitId,
      this.HEAD.commit,
      message
    );

    this.HEAD.commit = newCommit;
    return newCommit;
  }

  log() {
    const history = [];
    let current = this.HEAD.commit;

    while (current !== null) {
      history.push(current);
      current = current.parent;
    }

    return history;
  }

  checkout(branchName) {
    let branch = this.branches.find(
      branch => branch.name === branchName
    );

    if (!branch) {
      branch = new Branch(branchName, this.HEAD.commit);
      this.branches.push(branch);
    }

    this.HEAD = branch;
    return branch;
  }
}

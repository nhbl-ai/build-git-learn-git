//Check feature commit
// import { Commit } from './git.js';

// const first = new Commit(1, null, 'Tạo dự án');
// const second = new Commit(2, first, 'Thêm README');
// const third = new Commit(3, second, 'Thêm trang chủ');

// console.log(second.message);
// console.log(second.parent.message);
// console.log(first.parent);
// console.log(third.parent.parent.message);


// Check feature commit chain
// import { Git } from './git.js';

// const repo = new Git('my-project');

// console.log(repo.currentCommit === null); // true

// const first = repo.commit('Tạo dự án');
// const second = repo.commit('Thêm README');
// const third = repo.commit('Thêm trang admin');

// console.log(first.id === 1);                  // true
// console.log(second.id === 2);                 // true
// console.log(first.parent === null);           // true
// console.log(second.parent === first);         // true
// console.log(repo.currentCommit === second);   // true
// console.log(repo.currentCommit.parent.parent.message);


// Check feature log
// import { Git } from './git.js';

// const repo = new Git('my-project');

// repo.commit('Tạo dự án');
// repo.commit('Thêm README');
// repo.commit('Thêm trang chủ');

// const history = repo.log();

// for (const commit of history) {
//   console.log(`${commit.id}: ${commit.message}`);
// }

// // Đọc lịch sử không làm thay đổi commit hiện tại.
// console.log(repo.currentCommit.id === 3); // true

// // Repository chưa có commit trả về mảng rỗng.
// const emptyRepo = new Git('empty');
// console.log(emptyRepo.log().length === 0); // true

// console.log(repo.log().map(commit => commit.id));
// // [3, 2, 1]

// console.log(repo.log().map(commit => commit.id));
// // [3, 2, 1]


// Check feature branch
// import { Git } from './git.js';

// const repo = new Git('my-project');

// console.log(repo.HEAD.name);          // master
// console.log(repo.HEAD.commit);        // null
// console.log(repo.branches.length);    // 1

// repo.commit('Tạo dự án');
// const second = repo.commit('Thêm README');
// const third = repo.commit('Thêm trang khách hàng');

// console.log(repo.HEAD.commit === third); // true
// console.log(repo.log().map(c => c.id));    // [2, 1]


// Check feature checkout
// import { Git } from './git.js';

// const repo = new Git('my-project');

// repo.commit('Tạo dự án');   // Commit 1
// repo.commit('Thêm README'); // Commit 2

// repo.checkout('feature');
// repo.commit('Thêm trang chủ'); // Commit 3

// console.log(repo.HEAD.name);
// // feature

// console.log(repo.log().map(c => c.id));
// // [3, 2, 1]

// repo.checkout('master');

// console.log(repo.HEAD.name);
// // master

// console.log(repo.log().map(c => c.id));
// // [2, 1]

// repo.checkout('feature');

// console.log(repo.log().map(c => c.id));
// // [3, 2, 1]

// console.log(repo.branches.length);
// // 2

// repo.checkout('master');
// repo.commit('Sửa README');
// console.log(repo.log().map(c => c.id));
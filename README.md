# Build GIT – Learn GIT

Project JavaScript cá nhân để tự xây dựng mô hình Git đơn giản và hiểu repository, commit, lịch sử commit, branch và HEAD.

Dựa theo bài [Build GIT – Learn GIT (P1)](https://kushagra.dev/blog/build-git-learn-git/) của Kushagra Gour. [Repo của tác giả](https://github.com/chinchang/build-git-learn-git) dùng để tham khảo khi cần đối chiếu.

## Bắt đầu

Cài Node.js 22 trở lên. Project dùng JavaScript ES modules và chưa có dependency, nên không cần chạy `npm install`.

```sh
npm run check
```

Lệnh trên kiểm tra cú pháp JavaScript. Khung hiện tại chưa triển khai logic Git; các phương thức sẽ báo lỗi TODO cho đến khi bạn hoàn thành chúng.

## Lộ trình

- [ ] Tạo repository: lưu tên repo và trạng thái ban đầu.
- [ ] Xây dựng `Commit`: id, message và tham chiếu parent.
- [ ] Viết `commit(message)`: tạo commit mới và cập nhật con trỏ hiện tại.
- [ ] Viết `log()`: duyệt parent để trả về lịch sử từ mới đến cũ.
- [ ] Xây dựng `Branch`: tên và tham chiếu commit.
- [ ] Cho `HEAD` trỏ đến branch hiện tại.
- [ ] Viết `checkout(branchName)`: chuyển branch hoặc tạo branch mới như trong bài.
- [ ] Kiểm tra rằng commit trên một branch không làm thay đổi lịch sử branch khác.

Bạn có thể dùng tên branch mô phỏng `master` để khớp ví dụ trong bài. Branch thật của repo GitHub này là `main`.

## Thư mục

```text
src/
  git.js       # Khung Commit, Branch và Git để tự triển khai
package.json   # Cấu hình Node.js và lệnh kiểm tra cú pháp
```

Khi bắt đầu kiểm tra hành vi, bạn có thể tạo `test/git.test.js` bằng `node:test` rồi chạy `node --test`. Hãy kiểm tra repo rỗng, thứ tự lịch sử commit và việc tách lịch sử giữa các branch.

Đây là bài tập mô phỏng Git trong bộ nhớ. Việc lưu file, staging, object database, merge và rebase là các phần mở rộng sau.

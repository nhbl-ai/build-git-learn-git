# Build GIT – Learn GIT · v1.0.0

Project JavaScript để học cách Git tổ chức commit, branch, staging và trao đổi repository. Hiện có thể gửi **lịch sử commit và nội dung file giữa hai máy trong cùng Wi‑Fi/LAN** qua HTTP.

Đây là Git mô phỏng với định dạng riêng, không tương thích với `.git`, GitHub hay giao thức của Git thật. Dữ liệu được lưu trong `.learn-git/state.json`; có thể tắt và mở lại chương trình mà không mất lịch sử.

## Chạy chương trình

Cài Node.js **22 trở lên** và đặt mã nguồn project này trên cả hai máy. Project chỉ dùng module có sẵn của Node.js, không cần `npm install`.

Chạy các lệnh bên dưới từ thư mục chứa project. `-C` chọn thư mục repository cần thao tác; nếu bỏ `-C`, chương trình dùng thư mục hiện tại.

```powershell
node src/cli.js help
npm run check
npm test
```

## Thử giữa hai máy cùng Wi‑Fi/LAN

Ví dụ máy A có IP `192.168.1.10`. Thay IP này bằng địa chỉ thật mà lệnh `serve` in ra. Hai máy phải kết nối được tới nhau trên cổng `9418`.

### Máy A: tạo repository và mở server

Trong PowerShell, từ thư mục project:

```powershell
$env:LEARN_GIT_TOKEN = 'doi-thanh-token-rieng-cua-ban'

node src/cli.js -C demo-a init
Set-Content demo-a/hello.txt 'Xin chao tu may A'
node src/cli.js -C demo-a add .
node src/cli.js -C demo-a commit "Commit dau tien"
node src/cli.js -C demo-a serve --port 9418
```

`serve` lắng nghe tại `0.0.0.0` để máy khác trong LAN truy cập được và in các địa chỉ IPv4 LAN. Giữ terminal này chạy; dùng terminal khác để commit trong `demo-a`. Server đọc lại repository cho mỗi yêu cầu, nên không cần khởi động lại sau mỗi commit. Nhấn `Ctrl+C` để dừng.

Nếu Windows Firewall hỏi, cho phép Node.js trên **Private networks**. Nếu không kết nối được, kiểm tra IP/cổng, firewall và chế độ cách ly thiết bị của Wi‑Fi khách. Có thể thử trên một máy bằng hai thư mục với URL `http://127.0.0.1:9418`.

### Máy B: clone, sửa và gửi lại máy A

Trong PowerShell trên B, từ thư mục project trên B, đặt **cùng token** với A:

```powershell
$env:LEARN_GIT_TOKEN = 'doi-thanh-token-rieng-cua-ban'

node src/cli.js clone http://192.168.1.10:9418 demo-b
node src/cli.js -C demo-b log

Set-Content demo-b/hello.txt 'Da sua tren may B'
node src/cli.js -C demo-b add hello.txt
node src/cli.js -C demo-b commit "Cap nhat tu may B"
node src/cli.js -C demo-b push origin main
```

`clone` tạo thư mục mới, chép các branch và file đã commit, rồi cấu hình remote `origin` trỏ tới A. Sau `push`, branch `main` trên A cập nhật và `demo-a/hello.txt` đổi theo nếu working tree trên A sạch. File chưa commit trên B không được gửi.

Để nhận thay đổi mới mà A đã commit:

```powershell
node src/cli.js -C demo-b fetch origin
node src/cli.js -C demo-b branch
node src/cli.js -C demo-b pull origin main
```

`fetch` chỉ tải lịch sử và cập nhật các tham chiếu `origin/...`; `pull` tải lịch sử rồi đưa branch hiện tại và file tiến tới commit của remote nếu có thể fast-forward.

### Cho cả hai máy cùng chạy server

Máy B cũng có thể chạy server trong terminal riêng:

```powershell
$env:LEARN_GIT_TOKEN = 'doi-thanh-token-rieng-cua-ban'
node src/cli.js -C demo-b serve --port 9418
```

Ví dụ IP của B là `192.168.1.11`. Trong terminal thứ hai trên A, đặt cùng token rồi cấu hình remote tới B:

```powershell
$env:LEARN_GIT_TOKEN = 'doi-thanh-token-rieng-cua-ban'
node src/cli.js -C demo-a remote add may-b http://192.168.1.11:9418
node src/cli.js -C demo-a push may-b main
node src/cli.js -C demo-a pull may-b main
```

Cả A và B đều có thể nhận push trong khi server của mình chạy. Mỗi terminal dùng lệnh mạng cần đặt token; token không được ghi vào repository hoặc gửi theo lịch sử. Không đặt token thì server cho phép các máy truy cập được đọc và push. HTTP trong ví dụ không mã hóa nội dung hay token; dùng trên LAN tin cậy, không mở trực tiếp ra Internet.

## Các lệnh đã hỗ trợ

| Lệnh | Ý nghĩa |
| --- | --- |
| `init [name]` | Tạo repository, branch mặc định `main` |
| `add <file\|directory\|.> [...]` | Stage nội dung hiện tại; cũng stage việc xóa file đã theo dõi |
| `commit <message>` | Tạo snapshot từ staging, nối với commit cha |
| `status` | Hiển thị thay đổi staged, unstaged và file chưa theo dõi |
| `log [branch]` | Xem lịch sử từ commit mới đến cũ |
| `branch` | Liệt kê branch local và các tham chiếu đã fetch |
| `checkout <branch>` | Chuyển branch; tạo branch ở commit hiện tại nếu chưa có |
| `remote add <name> <url>` | Thêm địa chỉ máy khác |
| `remote` | Liệt kê các remote |
| `serve [--host <host>] [--port <n>]` | Phục vụ repository qua HTTP; mặc định `0.0.0.0:9418` |
| `clone <url> <directory>` | Chép repository vào thư mục mới hoặc rỗng |
| `fetch [remote]` | Tải commit và tham chiếu remote, giữ nguyên branch local và file |
| `pull [remote] [branch]` | Fetch và fast-forward branch đang checkout từ branch remote được chỉ định |
| `push [remote] [branch]` | Gửi branch local cùng tên lên remote |

Remote mặc định là `origin`, branch mặc định là branch đang checkout. `status` có hai cột: cột trái so sánh staging với commit, cột phải so sánh file trên đĩa với staging. `A` = thêm, `M` = sửa, `D` = xóa, `??` = chưa theo dõi.

## Khi hai máy cùng sửa

Push kiểm tra lịch sử và commit hiện tại của remote trước khi cập nhật. Push làm mất lịch sử của remote hoặc remote đổi trong lúc gửi sẽ bị từ chối. Pull chỉ fast-forward, hoặc giữ nguyên nếu local đã đi trước remote. Những hành vi này dựa trên ý tưởng của [git-push](https://git-scm.com/docs/git-push), [git-fetch](https://git-scm.com/docs/git-fetch) và [git-pull](https://git-scm.com/docs/git-pull).

Nếu A và B cùng tạo commit riêng từ một commit chung, lịch sử đã tách nhánh. Bản này sẽ báo `Non-fast-forward` vì **chưa có merge/rebase**. Có thể giữ công việc của một bên trong branch mới và push branch đó, thay vì ghi đè branch chung:

```powershell
node src/cli.js -C demo-b checkout cong-viec-b
node src/cli.js -C demo-b push origin cong-viec-b
```

Checkout/pull và push nhận vào branch hiện tại bảo vệ thay đổi chưa commit và file chưa theo dõi có thể bị ghi đè. Hãy commit trước khi cập nhật working tree. Push vào branch khác chỉ đổi con trỏ branch đó, không chuyển branch đang checkout trên máy nhận.

## API JavaScript

```js
import { Git } from './src/git.js';
import { createRemoteServer, clone, push, pull } from './src/remote.js';

const a = new Git('demo', { defaultBranch: 'main' });
a.add('hello.txt', 'Hello');
a.commit('initial');
const server = createRemoteServer(a, { token: 'shared-token' });
server.listen(9418, '0.0.0.0');

// Trên máy khác, hoặc sau khi server đã bắt đầu lắng nghe:
const b = await clone('http://192.168.1.10:9418', { token: 'shared-token' });
b.add('hello.txt', 'Hello from B');
b.commit('update');
await push(b, 'origin', 'main', { token: 'shared-token' });
await pull(b, 'origin', 'main', { token: 'shared-token' });
```

API `Git` chạy trong bộ nhớ; CLI dùng lớp lưu trữ trên đĩa. `Git(name)` giữ branch mặc định `master` để dùng với ví dụ trong bài gốc; CLI dùng `main`. `add(path, content)` nhận string UTF-8 hoặc `Buffer`; commit chứa file ở dạng base64 nên truyền được cả file nhị phân. Commit ID là SHA-256 của commit cha, message và snapshot; không dùng bộ đếm nên hai máy không tạo trùng ID cho nội dung khác nhau.

## Giới hạn hiện tại

- Chưa có merge, rebase, force push, tag, diff, author/timestamp hoặc giao thức Git thật.
- Truyền JSON chứa các snapshot commit đầy đủ, chưa có delta/pack hay chỉ truyền object còn thiếu. Mỗi request/response giới hạn **16 MiB**, client timeout **10 giây**; phù hợp repository nhỏ để học.
- `add .` bỏ qua `.git`, `.learn-git` và `node_modules`; chưa đọc quy tắc `.gitignore`. Chọn file rõ ràng khi không muốn stage mọi file trong thư mục.
- Chưa hỗ trợ symlink, quyền executable hoặc chuyển trực tiếp một đường dẫn từ file sang thư mục khi checkout/pull. Chặn đường dẫn vượt khỏi repository, metadata và tên file không an toàn trên Windows.
- Có lock để tránh hai lệnh cùng sửa metadata và ghi state qua file tạm rồi rename. Đây chưa phải hệ thống giao dịch chịu được mọi tình huống mất điện. Nếu chương trình bị buộc dừng và để lại `.learn-git/lock`, chỉ xóa lock sau khi chắc chắn không còn thao tác nào đang chạy trên repository đó.

## Cấu trúc và kiểm thử

```text
src/
  git.js          # Commit, Branch, staging, bundle và kiểm tra lịch sử
  remote.js       # HTTP server/client: clone, fetch, pull, push
  repository.js   # State trên đĩa, working tree và lock
  cli.js          # Lệnh dùng từ terminal
test/
  git.test.js     # Lịch sử, snapshot, ID, deserialize và bundle không hợp lệ
  remote.test.js  # Trao đổi HTTP, token, fast-forward, lịch sử tách nhánh
  cli.test.js     # Hai server thực, file trên đĩa và bảo vệ dữ liệu local
```

Chạy `npm test` để kiểm tra cả mô hình và các tiến trình HTTP thật trên localhost. Bộ kiểm thử tạo repository trong thư mục tạm rồi dọn chúng. Môi trường sandbox cần cho phép kết nối localhost và ghi/rename file để chạy kiểm thử tích hợp.

Ý tưởng ban đầu dựa theo bài [Build GIT – Learn GIT (P1)](https://kushagra.dev/blog/build-git-learn-git/) của Kushagra Gour và [repo tham khảo](https://github.com/chinchang/build-git-learn-git).

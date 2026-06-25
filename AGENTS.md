# AGENTS.md

이 문서는 Eats Pay 코드베이스에서 작업하는 AI 코딩 에이전트를 위한 지속 지시서입니다. 목표는 같은 디자인/클릭/로그인/배포 문제가 반복되지 않도록 실제 운영 기준을 먼저 고정하는 것입니다.

---

## 0. 최우선 작업 루트 고정

* 실제 Eats Pay 작업 루트는 `D:\Avicx\eatspay`입니다.
* 실제 관리자 운영 소스는 `D:\Avicx\eatspay\이츠페이_관리자_시스템_10.html`입니다.
* 운영 서버 반영 대상은 `/opt/eatspay`이며, 관리자 파일은 `/opt/eatspay/이츠페이_관리자_시스템_10.html`입니다.
* Codex가 `C:\Users\미노스\OneDrive\문서\eatspay` 같은 C: 경로에서 시작되면 이 D: 루트의 `AGENTS.md`가 자동 적용되지 않을 수 있습니다. 작업 전 반드시 실제 루트의 `AGENTS.md`와 대상 파일을 직접 확인합니다.
* C: 경로, 임시 폴더, 배포용 clean clone만 수정하고 완료로 보고하지 않습니다. 운영 반영이 필요한 작업은 실제 루트 수정, 검증, 배포 확인까지 이어갑니다.

---

## 1. 현재 시스템 구조

* 서버는 `server.js`, `db/repository.js`, `db/schema.sql`을 사용하는 Node.js/Express/PostgreSQL 기반입니다.
* 앱 화면은 `index.html`, `js/app.js`, `css/style.css`, `sw.js`, `www/`를 중심으로 동작합니다.
* 관리자 화면은 `이츠페이_관리자_시스템_10.html` 단일 HTML 구조입니다. 수정 시 관련 렌더 함수, 이벤트 위임부, 모달 함수, 저장 API 호출부를 함께 확인합니다.
* 모바일 앱은 Capacitor 기반입니다. APK 반영이 필요한 변경은 `www/` 동기화와 Android 빌드까지 별도로 확인합니다.
* `python -m http.server 8080`만으로는 현재 서버/DB 연동 동작을 검증할 수 없습니다. 기본 실행은 `npm start` 또는 `node server.js` 기준으로 봅니다.

---

## 2. UI/UX 일관성 규칙

모든 앱/관리자 화면 수정 전에는 [`docs/ui-consistency-directive.md`](docs/ui-consistency-directive.md)를 우선 확인합니다.

* 앱과 관리자 기본 폰트는 모두 `Pretendard`입니다.
* 메인 초록색은 `#03c75a`를 우선 사용합니다.
* 기존에 완성된 화면을 먼저 찾아 기준으로 삼고, 새 스타일을 즉흥적으로 만들지 않습니다.
* 반복되는 `style=""` 인라인 CSS와 `onclick=""` 직접 바인딩을 새로 늘리지 않습니다.
* 버튼, 칩, 테이블, 모달, 카드, 입력창은 공통 클래스를 사용합니다.
* 디자인을 수정할 때는 기능 이벤트가 바뀌지 않도록 실제 클릭 검증을 함께 합니다.

---

## 3. 관리자 모드 안정화 고정 규칙

관리자 페이지 작업은 클릭 먹통, 디자인 회귀, 새로고침 상태 유실, 로그인 입력 회귀를 막는 것이 최우선입니다.

### 클릭 이벤트

* 가맹점 목록, 대리점 목록, PG사 관리, FAQ, 공지사항, 이용가이드, 출금계좌 목록의 버튼/칩은 반드시 실제 클릭 검증까지 수행합니다.
* 링크형 이동은 `href="/admin?franchiseId=..."` 같은 실제 fallback URL을 유지하고, JS는 enhancement로만 사용합니다.
* 전역 click capture handler가 링크, 버튼, input, select, textarea, label 클릭을 막지 않도록 확인합니다.
* 행 클릭과 버튼 클릭이 겹치면 버튼/링크가 우선입니다. 행 클릭은 빈 영역 클릭에만 반응해야 합니다.

### 상세 화면과 새로고침

* 상세 화면은 URL 파라미터와 sessionStorage 양쪽에서 복구되어야 합니다.
* 새로고침은 로그인 화면이나 대시보드로 튕기면 안 됩니다. 현재 페이지의 데이터를 다시 받는 동작이어야 합니다.
* 목록에서 상세로 들어갔다가 뒤로 돌아와도 검색 필터, 정렬, 현재 메뉴 상태가 보존되어야 합니다.
* 로그아웃만 관리자 세션, 현재 페이지 키, 상세 id, 임시 필터를 비웁니다.

### 모달

* 관리자 모달은 바깥 배경 클릭으로 닫히면 안 됩니다.
* 닫기, 취소, 저장 버튼으로만 닫히게 합니다.
* 저장 실패 시 `Unexpected server error`만 보여주지 말고, 실패한 필드에 빨간 테두리나 구체 메시지를 표시합니다.

### 로그인

* 로그인 화면에서는 비밀번호 칸으로 강제 focus 이동을 하지 않습니다.
* 로그아웃 후에는 처음 로그인 화면처럼 초기화합니다.
* 아이디 저장 체크가 꺼져 있거나 사용자가 아이디를 지우면 저장된 아이디를 다시 자동 주입하지 않습니다.
* 비밀번호 입력값은 표시/숨김 버튼으로만 전환하며, 입력 자체가 사라지면 안 됩니다.

---

## 4. 데이터와 DB 기준

* 결제, 카드, 계좌, 관리자 데이터는 화면 표시가 아니라 실제 DB/API 상태를 기준으로 검증합니다.
* 가데이터와 실제 거래 데이터는 반드시 구분합니다. 실제 결제/정산/계좌 데이터는 사용자가 명시하지 않으면 삭제하지 않습니다.
* 삭제처럼 보이는 관리자 버튼은 실제 DB 삭제인지, 숨김/비활성인지 먼저 확인합니다.
* 회원 탈퇴, 카드 숨김, 계좌 숨김처럼 거래 보존이 필요한 기능은 DB 삭제가 아니라 상태 변경으로 처리하는 흐름을 우선합니다.

---

## 5. 빌드, 검증, 실행 명령

명령은 기본적으로 `D:\Avicx\eatspay`에서 실행합니다.

```powershell
npm start
```

기본 검증:

```powershell
node --check .\server.js
node --check .\js\app.js
npm run check:ui
npm test
```

관리자 HTML script 검증:

```powershell
Get-ChildItem -Filter "*관리자*.html" | Select-Object -First 1 | ForEach-Object {
  node -e "const fs=require('fs'); const html=fs.readFileSync(process.argv[1],'utf8'); const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(s=>s.trim()); for (const s of scripts) new Function(s); console.log('admin scripts ok', scripts.length);" $_.FullName
}
```

수정 내용이 특정 화면 클릭 문제라면 명령 검증만으로 완료 처리하지 않습니다. 반드시 브라우저에서 직접 클릭, 새로고침, 뒤로가기, 모달 저장/닫기까지 확인합니다.

---

## 6. 배포 확인 규칙

* 운영 반영이 필요한 변경은 로컬 수정으로 끝내지 않습니다.
* 배포 전후에 변경 파일, 배포 대상 경로, 서버 상태를 확인합니다.
* `scp`/`ssh`를 사용할 때는 현재 유효한 키와 서버 주소를 확인한 뒤 실행합니다. 지시서에 적힌 오래된 경로/서버값을 맹신하지 않습니다.
* 서버 반영 후에는 최소한 해당 파일 존재, Node syntax, 서비스 상태, 브라우저 동작 중 필요한 항목을 확인합니다.

예시 흐름:

```powershell
scp -i <ssh-key> <local-file> ubuntu@<server>:/tmp/<file>
ssh -i <ssh-key> ubuntu@<server> "sudo cp /tmp/<file> /opt/eatspay/<file> && sudo systemctl restart eatspay && sudo systemctl status eatspay --no-pager"
```

---

## 7. GitHub push 안전 규칙

* `D:\Avicx\eatspay` 저장소는 remote나 commit 상태가 불완전할 수 있으므로, push 전 반드시 아래를 확인합니다.

```powershell
git status --short
git remote -v
git log --oneline -3
```

* `git add .`로 전체를 올리지 않습니다. 관련 파일만 명시적으로 stage 합니다.
* `D:\Avicx\eatspay`에서 바로 push하기 어려운 상태라면, GitHub 원격 저장소를 clean clone한 뒤 변경 파일만 복사해 commit/push합니다.
* GitHub에 올릴 때는 로컬 백업, APK, 임시 이미지, 개인 키, 인증 파일, 로그 파일이 포함되지 않도록 반드시 확인합니다.

---

## 8. 작업 보고 규칙

* 사용자가 본 화면과 실제 서버/DB 상태가 다르면, 화면 추측보다 API/DB/브라우저 검증 결과를 우선합니다.
* 완료 보고 전에는 무엇을 수정했고, 어디에서 검증했으며, 무엇이 남았는지 짧게 정리합니다.
* 검증을 못 했으면 못 했다고 말합니다. “될 겁니다”를 완료처럼 말하지 않습니다.
* 사용자가 같은 문제를 반복 지적한 영역은 해당 원인을 문서나 공통 함수에 고정해 재발을 줄입니다.

---

## 9. 축소된 협업 원칙

역할극보다 실제 검증을 우선합니다.

* Orchestrator: 작업 범위와 운영 반영 여부를 놓치지 않습니다.
* Developer: 기존 구조와 공통 클래스를 확인한 뒤 최소 변경합니다.
* Validator: 명령 검증, 브라우저 클릭, 새로고침, 서버 반영 여부를 확인합니다.

이 세 역할은 별도 문서나 가상 프로토콜이 아니라, 한 작업 안에서 반드시 수행해야 하는 체크리스트입니다.

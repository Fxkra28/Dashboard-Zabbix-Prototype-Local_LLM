# HCML Monitoring Portal: handover handbook

| Who it is for | Reading time | Read first | Read next |
|---|---|---|---|
| Everyone | about 6 min | none | [Repository map](1-folders/repository-map.md) |

This handbook is for the person who takes over the portal. It has six parts. Part 0 is for people who do not read code and need to know what the portal is, what it shows and whom to trust on it. Parts 1 to 3 answer three questions in order of how often they are asked: where is everything, what does the code do, and what does the portal talk to. Part 4 is the day-to-day work: running it, rebuilding it, changing it and finding out why it broke. Part 5 is the reference: the decisions, the history, what is still open, and a glossary.

The portal is a web page that reads HCML's Zabbix and shows it more clearly: the open problems, the state of each site and device, graphs, the monthly SLA report, and an assistant that answers questions in plain language. It reads. The only thing it writes is the acknowledgement or closing of a problem, and only for operators and admins.

## Which way to read it

| You are | Read | What you will know afterwards |
|---|---|---|
| Anyone who needs to understand the portal, not run it | [Part 0](0-everyone/what-it-is.md) | What each page answers, who may do what, what leaves HCML's network, and what to ask HCML for |
| An operator who runs and watches it | Parts 1, 3, 4 and 5, with part 0 first | Where each thing lives, how it is started and rebuilt, what it depends on, and what to do when a page is slow or empty |
| A developer who changes it | All parts, part 2 last | What every folder and file is for, how a request travels, what each function does and why, and which test holds it |

Every page opens with a small box: who it is for, how long it takes, what to read before it and what to read after. The reading times are worked out from the page itself, so they follow it when it changes.

## The parts

| Part | What it holds | For | State |
|---|---|---|---|
| [0, Everyone](0-everyone/what-it-is.md) | What the portal is, the pages as questions they answer, who may do what, whether to trust a number, what leaves HCML, what HCML must provide, risks and costs, questions and terms, and one page for the operator's desk | Everyone | Written |
| [1, Folders](1-folders/repository-map.md) | The repository folder by folder and file by file, the two copies, and where to change a given thing | Operators and developers | Written |
| [2, Code](2-code/one-request.md) | How one request travels, then the important functions one by one with the real code beside the explanation, a card for every source file, an A to Z index of every name the code exports, and a map of the tests | Developers | Written |
| [3, Integrations](3-integrations/map.md) | Zabbix, the AI providers, nginx and Docker, sign-in, the report files, operations, and GitHub and its checks: what each one needs, what the portal sends, what comes back, how it fails | Operators and developers | Written |
| [4, Working](4-working/run-it.md) | Run it, deploy it, roll it back, change it, find out why it broke, the traps that cost time before, and [twelve exercises](4-working/exercises.md) for a new owner | Operators and developers | Written |
| [5, Reference](5-reference/decisions.md) | The decisions and why, the history, what is still open, a glossary, and how this handbook is kept true | Everyone | Written |

## How the handbook stays true

Tables, trees, the A to Z index and every piece of quoted code are written by a program from the code, not typed. `npm run handover:build` rewrites them. A checker, `npm run check:handover`, which `npm run verify` also runs, fails when any of them no longer matches the code, when a folder or a code file has no description, and when a page breaks the writing rules of the repository.

The explanation beside a piece of quoted code is written by a person, and a person can fall behind the code. So each quoted piece carries a short fingerprint of the code its explanation was written against. When that code changes, the checker fails until someone reads the explanation again and records that they did. [How the handbook is kept true](5-reference/how-the-handbook-is-kept-true.md) describes the commands and the rules.

## Conventions

A name in code font is a name that exists in the code, and the checker looks it up. A path starts at the repository root unless the page says it is short for a folder.

The handbook is the same in both copies of the portal, `hcml-portal` and `hcml-portal-ollama`. `hcml-portal` asks hosted Claude and answers on port 8081, and `hcml-portal-ollama` asks a model on the same machine and answers on port 8082. Where the copies differ, the page says which is which; [the two copies](1-folders/the-two-copies.md) lists every difference.

No page holds a password, a token, a host name from HCML's network or an address. Where one is needed, the page says where to find it.

The diagrams are in [`docs/handover/diagrams/`](diagrams/) as Mermaid sources, each with a PDF and a PNG render beside it and a stamp that a checker compares with the source.

## Ringkasan dalam Bahasa Indonesia

Buku panduan ini ditulis untuk orang yang akan mengambil alih portal pemantauan HCML. Isinya menjawab tiga pertanyaan: di mana semuanya berada (folder dan berkas), apa yang dikerjakan kode (fungsi demi fungsi), dan dengan apa portal berhubungan (Zabbix, penyedia AI, nginx dan Docker, GitHub).

Portal adalah halaman web yang membaca data Zabbix milik HCML dan menampilkannya lebih jelas: masalah yang sedang terbuka, keadaan tiap situs dan perangkat, grafik, laporan SLA bulanan, dan sebuah asisten yang menjawab pertanyaan dengan bahasa biasa. Portal hanya membaca. Satu-satunya yang ditulisnya adalah menandai sebuah masalah sebagai sudah diketahui atau menutupnya, dan itu hanya boleh dilakukan operator dan admin.

Ada dua salinan portal. `hcml-portal` memakai Claude di internet untuk jawaban AI dan berjalan di port 8081. `hcml-portal-ollama` memakai model di komputer sendiri sehingga tidak ada data yang keluar, dan berjalan di port 8082. Kodenya sama persis. Yang berbeda hanya beberapa berkas pengaturan dan dokumen.

Pilih jalur baca menurut peran. Siapa pun yang hanya perlu memahami portal membaca bagian 0. Operator yang menjalankan dan memantau portal membaca bagian 1, 3, 4 dan 5. Pengembang yang mengubah kode membaca semuanya. Setiap halaman diawali kotak kecil yang menyebut untuk siapa halaman itu, berapa lama membacanya, apa yang dibaca sebelumnya dan sesudahnya.

Tiga hal yang perlu diketahui lebih dulu:

1. Portal tidak punya database. Semua angka dihitung dari Zabbix saat diminta, disimpan sebentar di memori, dan hilang ketika portal dimulai ulang.
2. Berkas pengaturan `.env` berisi kata sandi dan token. Berkas itu tidak ada di git dan harus dicadangkan sendiri.
3. Setiap perubahan kode harus dibuat di kedua salinan. Perintah `npm run verify` memeriksa banyak hal sekaligus, termasuk bahwa kedua salinan tetap sama.

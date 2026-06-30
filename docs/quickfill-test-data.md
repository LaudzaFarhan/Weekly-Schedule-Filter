# Quick Fill — Test Data

A library of chatbot transcripts for verifying the **Trial Input → Chatbot Quick Fill** parser. Each block is meant to be pasted directly into the textarea on `/trial-input`.

## How to use

1. `npm run dev` → log in → open **Input Trial Leads**.
2. Pick a sample below, copy the block (just the lines between the dashes, not the title), and paste it into the **Chatbot Quick Fill** box.
3. Click **Auto-Fill**.
4. Verify the form fills out as listed under **Expected**. The branch picker at the top of the form should switch automatically and the toast should confirm the parsed values.

> Branch matching is data-driven. If your Admin → Branches list uses different names, the parser still works as long as the `Branch:` line in the transcript matches one of those names (case-insensitive).

---

## Format notes

- Field keys are bilingual. Use either the English (`Student`, `Date`, `Time`, `Branch`) or the Indonesian (`Anak`, `Tanggal`, `Jam`, `Cabang`) form. The parser accepts both.
- Date formats: `21/12/2025`, `21-12-2025`, `21 December 2025`, `2025-12-21`.
- Time formats: `1pm`, `13.00`, `1.30 sore`, `4:30`. Bare `1`–`6` defaults to PM (afternoon teaching window).
- Lines that don't match a known key are kept in the **Remarks** box, so nothing from the transcript is silently dropped.
- Age → program: 4–7 = Trial Kinder, 8–10 = Trial Junior, 11+ = Trial Coder. An explicit `Program:` line wins over the age inference.
- Every sample uses the same Notes/Catatan/Experience string so it's easy to spot in the Trial Leads sheet:
  ```
  THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
  ```

---

## Gading Serpong

### Sample 1 — Kinder, English keys, ISO date

```
Parent : Anastasia Wijaya
Student : Sky Rianto
Phone : 08123456789
Age : 6
Branch : Gading Serpong
Date : 2026-06-08
Time : 10am
Notes : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Kinder
- Date: 2026-06-08 (Monday)
- Time: 10.00 - 11.00 am
- Branch: Gading Serpong (form picker + global branch both switch)
- Remarks: Parent + Phone + Notes lines preserved

---

### Sample 2 — Junior, Indonesian keys, DMY date

```
Orang tua : Pak Hendra
Anak : Naya Karina
WA : 0812-9988-7766
Umur : 9
Cabang : Gading Serpong
Tanggal : 13/06/2026
Jam : 1.30 sore
Catatan : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Junior
- Date: 2026-06-13 (Saturday)
- Time: 1.30 - 2.30 pm
- Branch: Gading Serpong
- Toast variant: success

---

### Sample 3 — Coder, mixed keys, bare PM time

```
Parent : Yulia Hartono
Student : Reinhart Budi
Age : 12
Cabang : Gading Serpong
Tanggal : Sat 20 June 2026
Jam : 4
Experience : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Coder (age 12)
- Date: 2026-06-20
- Time: 4.00 - 5.00 pm (bare `4` resolves to 4 pm)
- Branch: Gading Serpong
- Remarks line includes the Experience text

---

## Puri Indah

### Sample 1 — Kinder, branch name appears in free text

```
Mama : Felicia Suharto
Student : Aiden Hartanto
Phone : 0813-2233-4455
Age : 5
Date : 9 June 2026
Time : 11am
Notes : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Kinder
- Branch: Puri Indah (parser picks this up from the explicit `Branch:` line; if you remove the Branch field, the parser still finds "Puri Indah" elsewhere in the text)
- Date: 2026-06-09 (Tuesday)
- Time: 11.00 am - 12.00 pm

> If you want to test the free-text fallback specifically, replace the `Notes:` line with:
> `Notes : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA) — trial di Puri Indah`
> and remove the explicit `Branch:` line entirely.

---

### Sample 2 — Junior, end-of-week slot

```
Orang tua : Bapak Siregar
Anak : Kayla Siregar
WA : 081234567000
Age : 10
Branch : Puri Indah
Tanggal : 13-06-2026
Time : 3pm
Catatan : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Junior
- Date: 2026-06-13 (Saturday)
- Time: 3.00 - 4.00 pm
- Branch: Puri Indah

---

### Sample 3 — Coder, explicit program override

```
Parent : Tania Lim
Student : Marcus Lim
Phone : 0822-1100-2233
Age : 9
Program : Trial Coder
Cabang : Puri Indah
Tanggal : 16/06/2026
Jam : 5.00 sore
Experience : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: **Trial Coder** (explicit `Program:` overrides the age 9 inference)
- Branch: Puri Indah
- Date: 2026-06-16 (Tuesday)
- Time: 5.00 - 6.00 pm

---

## Default Branch (legacy / fallback)

If your project still has a `Default Branch` entry in Admin → Branches, these test it. Skip this section if Default Branch is disabled.

### Sample 1 — Kinder, no branch line

```
Parent : Maya Soetanto
Student : Lila Soetanto
Age : 7
Date : 11 June 2026
Time : 11am
Notes : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Kinder
- Branch: **none detected** (warning toast — pick branch manually)
- Date: 2026-06-11 (Thursday)
- Time: 11.00 am - 12.00 pm

---

### Sample 2 — Junior, full minimal

```
Anak : Davian Tanu
Umur : 9
Cabang : Default Branch
Tanggal : 12/06/2026
Jam : 1pm
Catatan : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Junior
- Branch: Default Branch
- Date: 2026-06-12 (Friday)
- Time: 1.00 - 2.00 pm

---

### Sample 3 — Coder, branch in free text

```
Nama anak : Ezra Wahyudi
WA orang tua : 0856-1122-3344
Umur : 11
Tanggal : 18 June 2026
Jam : 2pm
Lokasi : Default Branch
Catatan : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```

**Expected**
- Program: Trial Coder
- Branch: Default Branch
- Time: 2.00 - 3.00 pm
- Remarks: Catatan line preserved

---

## Edge cases (worth testing once)

### Sunday date — should warn

```
Student : Ezra Aiden
Age : 8
Branch : Gading Serpong
Date : 14/06/2026
Time : 11am
Notes : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```
14 June 2026 is a Sunday. Expected: warning toast `"Trial date falls on Sunday — please reschedule."` Day field is left empty so the user fixes it.

---

### Unknown branch — should warn

```
Student : Test Student
Age : 8
Branch : Cilandak Mall
Date : 15/06/2026
Time : 11am
Notes : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```
If `Cilandak Mall` is not in Admin → Branches, expected toast: `"Branch \"Cilandak Mall\" did not match any configured branch."` The branch picker stays empty.

---

### Mostly-junk text — should still extract what it can

```
Available Schedule
Anak : Lila Pertiwi
Umur : 9
Phone : 0812-3344-5566
Tanggal : 17 Juni 2026
Jam : 4 sore
Lokasi : Puri Indah
Catatan : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)


Not Available Schedule 
Anak : Lila Pertiwi
Umur : 15
Phone : 0812-3344-5566
Tanggal : 13 Juni 2026
Jam : 4.30 sore
Lokasi : Gading Serpong
Catatan : THIS IS A TEST FEATURE FROM A CHATBOT (LAUDZA)
```
Expected: Age 9 → Trial Junior, Branch: Puri Indah, Date: 2026-06-17, Time: 4.00 - 5.00 pm. Catatan line lands in Remarks.

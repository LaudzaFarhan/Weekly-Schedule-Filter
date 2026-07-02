# Testing the CRM Webhook Endpoint

This guide outlines how to test the Next.js API endpoint for the CRM chatbot webhook.

## Endpoint Details
*   **Production URL**: `https://<your-vercel-domain>/api/crm`
*   **Local Development URL**: `http://localhost:3000/api/crm`
*   **HTTP Method**: `POST`

---

## Required Headers
To successfully authenticate, the webhook sender must supply the following headers:
*   **`Content-Type`**: `application/json`
*   **`Authorization`**: `Bearer <CRM_API_KEY>`

> [!NOTE]
> The default fallback API key in development is `crm-secure-key-12345`. In production, set the `CRM_API_KEY` environment variable in Vercel and pass the configured value.

---

## JSON Payload Formats
The endpoint accepts two payload structures depending on the integration type:

### 1. Format A: WhatsApp Chatbot Lead Payload
Used when forwarding trial booking details directly from WhatsApp chatbot flows. The endpoint automatically formats this payload into a readable client lead.

```json
{
  "parent_name": "Sari",
  "child_name": "Alya Putri",
  "age": "6",
  "program": "Trial Kinder",
  "location": "Puri Indah",
  "instructor": "Abel",
  "day": "Saturday",
  "date": "2026-07-05",
  "time": "10.00 - 11.00 am",
  "phone_number": "628123456789"
}
```

### 2. Format B: General / Direct Lead Payload
Used for standard direct submissions (e.g., custom forms or internal tools).

```json
{
  "name": "WhatsApp Bot Test Lead",
  "phone": "628123456789",
  "message": "Hi, I saw your program on Instagram. I would like to book a trial class.",
  "status": "interest_trial",
  "notes": "Submitted via WhatsApp Bot Integration API",
  "branch": "Puri Indah"
}
```

---

## Automated Test Scripts
You can quickly run automated tests in development using Node.js to verify the CRM integration:

1.  **General / Direct Lead integration test**:
    ```bash
    node scratch/test_crm_api.js
    ```
2.  **WhatsApp Chatbot Lead integration test**:
    ```bash
    node scratch/test_whatsapp_crm_webhook.js
    ```

---

## Manual Test Methods

### 1. Using curl (Terminal)
Replace `<your-domain>` with your actual domain or use `localhost:3000` for local testing:

#### Test Format A (WhatsApp Chatbot Lead):
```bash
curl -X POST "https://<your-domain>/api/crm" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer crm-secure-key-12345" \
     -d '{
       "parent_name": "Sari",
       "child_name": "Alya Putri",
       "age": "6",
       "program": "Trial Kinder",
       "location": "Puri Indah",
       "instructor": "Abel",
       "day": "Saturday",
       "date": "2026-07-05",
       "time": "10.00 - 11.00 am",
       "phone_number": "628123456789"
     }'
```

#### Test Format B (General / Direct Lead):
```bash
curl -X POST "https://<your-domain>/api/crm" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer crm-secure-key-12345" \
     -d '{
       "name": "WhatsApp Bot Test Lead",
       "phone": "628123456789",
       "message": "Hi, I would like to book a trial class.",
       "status": "interest_trial",
       "notes": "Submitted via terminal curl test"
     }'
```

### 2. Using Postman
1. Create a new request.
2. Set the method to **`POST`**.
3. Set the URL to: `https://<your-domain>/api/crm`.
4. In the **Headers** tab, add:
   *   Key: `Authorization`, Value: `Bearer crm-secure-key-12345`
5. In the **Body** tab, choose **raw**, select **JSON**, and paste one of the JSON formats from above.
6. Click **Send**.

---

## Expected Response (POST)
A successful creation request returns a `200 OK` status with the following body:
```json
{
  "success": true,
  "message": "CRM lead successfully created",
  "id": "FIRESTORE_DOCUMENT_ID"
}
```

Once a successful response is received:
*   **Format A leads** will appear in the **CRM Lead Pipeline** on the dashboard under the **Trial Booked** column.
*   **Format B leads** will appear under the **Interested (Trial)** column by default.

---

## 3. Updating Lead Status (PATCH)
We also support updating existing leads (such as changing status, notes, or branch) via a `PATCH` request to the same endpoint.

### Endpoint Details
*   **Production URL**: `https://<your-vercel-domain>/api/crm`
*   **Local Development URL**: `http://localhost:3000/api/crm`
*   **HTTP Method**: `PATCH`

### Required Payload Fields
*   **`id`** (or `leadId` / `lead_id`): The Firestore document ID of the lead to update (Required).
*   One or more of the following updateable fields (Optional):
    *   **`status`**: e.g., `'interest_trial'`, `'no_response'`, `'trial_booked'`, `'closed'`
    *   **`notes`**: text string
    *   **`message`**: text string
    *   **`name`**: text string
    *   **`phone`**: text string
    *   **`branch`**: text string

### Example Payload
```json
{
  "id": "FIRESTORE_DOCUMENT_ID",
  "status": "trial_booked",
  "notes": "Status updated by WhatsApp automation."
}
```

### curl Example (Terminal)
```bash
curl -X PATCH "https://<your-domain>/api/crm" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer crm-secure-key-12345" \
     -d '{
       "id": "FIRESTORE_DOCUMENT_ID",
       "status": "trial_booked",
       "notes": "Status updated by terminal curl test"
     }'
```

### Expected Response (PATCH)
```json
{
  "success": true,
  "message": "CRM lead successfully updated",
  "id": "FIRESTORE_DOCUMENT_ID",
  "updatedFields": ["status", "notes"]
}
```

---

## Automated Test Scripts
You can quickly run automated tests in development using Node.js to verify the CRM integration:

1.  **General / Direct Lead integration test (POST)**:
    ```bash
    node scratch/test_crm_api.js
    ```
2.  **WhatsApp Chatbot Lead integration test (POST)**:
    ```bash
    node scratch/test_whatsapp_crm_webhook.js
    ```
3.  **CRM Lead Update integration test (PATCH)**:
    ```bash
    node scratch/test_crm_patch_api.js
    ```


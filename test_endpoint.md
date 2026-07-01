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

## Expected Response
A successful request returns a `200 OK` status with the following body:
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

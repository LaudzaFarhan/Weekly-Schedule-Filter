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

## JSON Payload Format
The endpoint accepts the following structure for WhatsApp chatbot leads:

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

---

## Test Methods

### 1. Using curl (Terminal)
Replace `<your-domain>` with your actual domain or use `localhost:3000` for local testing:

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

### 2. Using Postman
1. Create a new request.
2. Set the method to **`POST`**.
3. Set the URL to: `https://<your-domain>/api/crm`.
4. In the **Headers** tab, add:
   *   Key: `Authorization`, Value: `Bearer crm-secure-key-12345`
5. In the **Body** tab, choose **raw**, select **JSON**, and paste the payload format from above.
6. Click **Send**.

### 3. Using JavaScript / Node.js
```javascript
fetch("https://<your-domain>/api/crm", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer crm-secure-key-12345"
  },
  body: JSON.stringify({
    parent_name: "Sari",
    child_name: "Alya Putri",
    age: "6",
    program: "Trial Kinder",
    location: "Puri Indah",
    instructor: "Abel",
    day: "Saturday",
    date: "2026-07-05",
    time: "10.00 - 11.00 am",
    phone_number: "628123456789"
  })
})
.then(res => res.json())
.then(data => console.log("Success:", data))
.catch(err => console.error("Error:", err));
```

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

Once a successful response is received, the lead will appear in the **CRM Lead Pipeline** on the dashboard under the **Trial Booked** column.

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAmeryoAv6Nisk7foNUPOAQ3WIfYUajyOQ",
  authDomain: "weekly-schedule-chatbot.firebaseapp.com",
  projectId: "weekly-schedule-chatbot",
  storageBucket: "weekly-schedule-chatbot.firebasestorage.app",
  messagingSenderId: "479018870777",
  appId: "1:479018870777:web:d329c6f253ca80fe303f28",
  measurementId: "G-8BRCJLZFLF",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;

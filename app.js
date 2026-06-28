// app.js
import { extractOTPs, extractMagicLinks } from './extractor.js';

// --- CONFIGURATION ---
const SUPABASE_URL = 'https://piwzmvnfhnbtssgpxyuo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpd3ptdm5maG5idHNzZ3B4eXVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NTY4NDYsImV4cCI6MjA5ODAzMjg0Nn0.sBoCBsPVjzH295Q4moXYvwtgeigNTdLqkWMXYkrJmAA';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- STATE ---
let activeAddress = null;
let activeSubscription = null;

// --- SILENT AUTHENTICATION ---
// This runs immediately to secure the session
async function initializeAnonymousSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) console.error("Silent Auth Error:", error);
    }
}
initializeAnonymousSession();

// --- DOM ELEMENTS ---
const viewLanding = document.getElementById('landing-view');
const viewInbox = document.getElementById('inbox-view');
const inputUsername = document.getElementById('username-input');
const selectDomain = document.getElementById('domain-select');
const btnRandom = document.getElementById('btn-random');
const btnCreate = document.getElementById('btn-create');
const btnCopyCreate = document.getElementById('btn-copy-create');
const btnChangeAddress = document.getElementById('btn-change-address');
const toastContainer = document.getElementById('toast-container');
const emailList = document.getElementById('email-list');

// --- UTILITIES ---
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'bg-gray-900 text-white px-6 py-3 rounded-md shadow-lg text-sm font-medium toast-exit';
    toast.textContent = message;
    toastContainer.appendChild(toast);
    
    setTimeout(() => { toast.classList.remove('toast-exit'); toast.classList.add('toast-enter'); }, 10);
    setTimeout(() => {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function copyToClipboard(text, successMessage) {
    navigator.clipboard.writeText(text).then(() => showToast(successMessage));
}

// --- LOGIC ---
btnRandom.addEventListener('click', () => {
    inputUsername.value = Math.random().toString(36).substring(2, 10);
});

async function handleCreate(copy = false) {
    const user = inputUsername.value.trim().toLowerCase();
    if (!user) return showToast('Please enter a username');
    
    // --- CAPTCHA CHECK ---
    // Make sure the user completed the Cloudflare Turnstile challenge
    const turnstileResponse = window.turnstile ? window.turnstile.getResponse() : null;
    if (!turnstileResponse) {
        return showToast('Please complete the CAPTCHA check.');
    }
    
    const domain = selectDomain.value;
    const fullEmail = `${user}@${domain}`;
    
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Get the silent User ID
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
        window.turnstile.reset(); // Reset CAPTCHA so they can try again
        return showToast('Authentication failed. Please refresh the page.');
    }

    // Insert into Supabase (Now includes user_id for RLS security)
    const { data, error } = await supabase
        .from('addresses')
        .insert([{ 
            email: fullEmail, 
            domain: domain, 
            expires_at: expiresAt.toISOString(),
            user_id: authUser.id 
        }])
        .select()
        .single();

    if (error) {
        window.turnstile.reset(); // Reset CAPTCHA on database error
        return showToast('Error creating inbox: ' + error.message);
    }

    activeAddress = fullEmail;
    
    if (copy) copyToClipboard(fullEmail, 'Address copied and Inbox created!');
    else showToast('Inbox created successfully!');

    // Reset Turnstile for the next time they return to the landing screen
    window.turnstile.reset();

    setupInboxView(fullEmail, expiresAt);
}

btnCreate.addEventListener('click', () => handleCreate(false));
btnCopyCreate.addEventListener('click', () => handleCreate(true));
btnChangeAddress.addEventListener('click', () => {
    if (activeSubscription) supabase.removeChannel(activeSubscription);
    viewInbox.classList.add('hidden-view');
    viewLanding.classList.remove('hidden-view');
    activeAddress = null;
    emailList.innerHTML = '';
});

// --- INBOX VIEW RENDERING ---
function setupInboxView(email, expiresAt) {
    viewLanding.classList.add('hidden-view');
    viewInbox.classList.remove('hidden-view');
    
    document.getElementById('active-email-display').textContent = email;
    document.getElementById('expiry-display').textContent = `Expires: ${expiresAt.toLocaleString()}`;
    
    fetchInitialEmails(email);
    subscribeToEmails(email);
}

async function fetchInitialEmails(recipient) {
    const { data, error } = await supabase
        .from('emails')
        .select('*')
        .eq('recipient', recipient)
        .order('received_at', { ascending: false })
        .limit(5);
        
    if (data && data.length > 0) {
        renderEmails(data);
    }
}

function subscribeToEmails(recipient) {
    activeSubscription = supabase
        .channel('public:emails')
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'emails', 
            filter: `recipient=eq.${recipient}` 
        }, payload => {
            showToast('New email received!');
            fetchInitialEmails(recipient);
        })
        .subscribe();
}

function renderEmails(emailsArray) {
    if (emailsArray.length === 0) return;
    
    emailList.innerHTML = '';
    
    const latestEmail = emailsArray[0];
    const extractedBody = latestEmail.body_text || latestEmail.body_html || '';
    
    const { primary: pOtp, others: oOtps } = extractOTPs(extractedBody);
    const { primary: pLink, others: oLinks } = extractMagicLinks(extractedBody, latestEmail.sender_email);
    
    updateExtractionUI(pOtp, oOtps, pLink, oLinks);

    emailsArray.forEach(email => {
        const div = document.createElement('div');
        div.className = 'bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition cursor-pointer';
        div.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-gray-900">${email.sender_name || email.sender_email}</span>
                <span class="text-xs text-gray-500 font-medium">${new Date(email.received_at).toLocaleTimeString()}</span>
            </div>
            <p class="font-semibold text-gray-800 text-sm mb-1">${email.subject || 'No Subject'}</p>
            <p class="text-sm text-gray-500 truncate">${email.preview || email.body_text?.substring(0, 100) || '...'}</p>
        `;
        emailList.appendChild(div);
    });
}

function updateExtractionUI(pOtp, oOtps, pLink, oLinks) {
    const extContainer = document.getElementById('extraction-container');
    const otpPanel = document.getElementById('otp-panel');
    const linkPanel = document.getElementById('magic-link-panel');

    let hasExtraction = false;

    if (pOtp) {
        hasExtraction = true;
        otpPanel.classList.remove('hidden-view');
        document.getElementById('primary-otp').textContent = pOtp.code;
        
        const copyBtn = document.getElementById('btn-copy-primary-otp');
        copyBtn.onclick = () => copyToClipboard(pOtp.code, 'OTP Copied!');

        const otherContainer = document.getElementById('other-otps-container');
        const otherList = document.getElementById('other-otps-list');
        if (oOtps.length > 0) {
            otherContainer.classList.remove('hidden-view');
            otherList.innerHTML = oOtps.map(o => `
                <div class="flex justify-between items-center bg-gray-50 px-3 py-1.5 rounded">
                    <span class="font-mono text-gray-700 font-medium">${o.code}</span>
                    <button class="text-blue-600 text-xs font-semibold hover:underline" onclick="navigator.clipboard.writeText('${o.code}')">Copy</button>
                </div>
            `).join('');
        } else {
            otherContainer.classList.add('hidden-view');
        }
    } else {
        otpPanel.classList.add('hidden-view');
    }

    if (pLink) {
        hasExtraction = true;
        linkPanel.classList.remove('hidden-view');
        document.getElementById('primary-link-name').textContent = pLink.hostname;
        document.getElementById('btn-open-primary-link').href = pLink.url;
        
        const copyBtn = document.getElementById('btn-copy-primary-link');
        copyBtn.onclick = () => copyToClipboard(pLink.url, 'Link Copied!');

        const otherContainer = document.getElementById('other-links-container');
        const otherList = document.getElementById('other-links-list');
        if (oLinks.length > 0) {
            otherContainer.classList.remove('hidden-view');
            otherList.innerHTML = oLinks.map(l => `
                <div class="flex justify-between items-center bg-gray-50 px-3 py-1.5 rounded gap-2">
                    <span class="text-gray-600 text-xs truncate flex-1" title="${l.url}">${l.hostname}</span>
                    <button class="text-blue-600 text-xs font-semibold hover:underline shrink-0" onclick="navigator.clipboard.writeText('${l.url}')">Copy</button>
                </div>
            `).join('');
        } else {
            otherContainer.classList.add('hidden-view');
        }
    } else {
        linkPanel.classList.add('hidden-view');
    }

    if (hasExtraction) {
        extContainer.classList.remove('hidden-view');
    } else {
        extContainer.classList.add('hidden-view');
    }
}

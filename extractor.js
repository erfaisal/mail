// extractor.js

export const extractOTPs = (emailBody) => {
    if (!emailBody) return { primary: null, others: [] };
    
    const regex = /(?<!\d)(\d{4,9})(?!\d)/g;
    const matches = [...emailBody.matchAll(regex)];
    
    let candidates = new Map();
  
    matches.forEach(match => {
        const code = match[0];
        const index = match.index;
        const length = code.length;
        
        if (candidates.has(code)) {
            candidates.get(code).score += 5; 
            return;
        }
  
        let score = 0;
        if (length === 6) score += 100;
        else if (length === 4) score += 90;
        else if (length === 8) score += 80;
        else if (length === 7) score += 70;
        else if (length === 5) score += 60;
        else if (length === 9) score += 50;
  
        const start = Math.max(0, index - 100);
        const end = Math.min(emailBody.length, index + code.length + 100);
        const context = emailBody.substring(start, end).toLowerCase();
  
        if (/(otp|verification|verify|one-time password|2fa|authentication|pin)/.test(context)) score += 80;
        else if (/(login|signin|activate|register|authenticate|secure)/.test(context)) score += 40;
        else if (/(code|token|temporary)/.test(context)) score += 20;
  
        if (/(order|invoice|tracking|shipment|payment|transaction)/.test(context)) score -= 80;
        else if (/(support|privacy|unsubscribe|marketing)/.test(context)) score -= 40;
  
        const positionPercent = index / emailBody.length;
        if (positionPercent <= 0.20) score += 30;
        else if (positionPercent <= 0.50) score += 10;
  
        candidates.set(code, { code, score });
    });
  
    const sorted = Array.from(candidates.values()).sort((a, b) => b.score - a.score);
    return {
        primary: sorted.length > 0 && sorted[0].score > 50 ? sorted[0] : null,
        others: sorted.length > 1 ? sorted.slice(1) : (sorted.length === 1 && sorted[0].score <= 50 ? sorted : [])
    };
};
  
export const extractMagicLinks = (emailBody, senderEmail) => {
    if (!emailBody) return { primary: null, others: [] };
  
    const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
    const matches = [...emailBody.matchAll(urlRegex)];
    
    let candidates = new Map();
    const senderDomain = senderEmail ? senderEmail.split('@')[1] : '';
  
    matches.forEach(match => {
        const urlStr = match[0];
        if (candidates.has(urlStr)) return; 
  
        try {
            const url = new URL(urlStr);
            let score = 0;
  
            if (senderDomain) {
                if (url.hostname === senderDomain) score += 120;
                else if (url.hostname.endsWith(senderDomain)) score += 80; 
                else score -= 150; 
            }
  
            const urlLower = urlStr.toLowerCase();
            if (/(verify|activate|magic|signin|login|auth|confirm)/.test(urlLower)) score += 80;
            if (/(account|security|identity|session)/.test(urlLower)) score += 40;
            
            // Heavy penalty for stop/unsubscribe
            if (/(unsubscribe|privacy|terms|stop|33mail\.com\/stop)/.test(urlLower)) score -= 120;
  
            const positionPercent = match.index / emailBody.length;
            if (positionPercent <= 0.25) score += 30;
            else if (positionPercent <= 0.75) score += 10;
  
            candidates.set(urlStr, { url: urlStr, hostname: url.hostname, score });
        } catch (e) { /* Ignore invalid URLs */ }
    });
  
    const sorted = Array.from(candidates.values()).sort((a, b) => b.score - a.score);
    return {
        primary: sorted.length > 0 && sorted[0].score > 0 ? sorted[0] : null,
        others: sorted.length > 1 ? sorted.slice(1) : (sorted.length === 1 && sorted[0].score <= 0 ? sorted : [])
    };
};

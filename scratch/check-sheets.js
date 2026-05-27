const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function check() {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    console.log("Sheet ID:", sheetId);
    console.log("Client Email:", clientEmail);
    console.log("Private Key length:", privateKey?.length);

    if (!sheetId || !clientEmail || !privateKey) {
        console.error("Credentials missing!");
        return;
    }

    try {
        const serviceAccountAuth = new JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        console.log("Spreadsheet Title:", doc.title);
        console.log("Tabs list:");
        doc.sheetsByIndex.forEach((s, idx) => {
            console.log(`- [${idx}] ${s.title}`);
        });

        let sheet = doc.sheetsByTitle['PhanQuyen'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'phanquyen');
        if (sheet) {
            console.log("Tab 'PhanQuyen' exists!");
            const rows = await sheet.getRows();
            console.log(`Number of rows: ${rows.length}`);
            rows.forEach((r, idx) => {
                console.log(`  Row ${idx + 1}: ThreadID=${r.get('ThreadID')}, Name=${r.get('Name')}, AllowedFeatures=${r.get('AllowedFeatures')}`);
            });
        } else {
            console.log("Tab 'PhanQuyen' does NOT exist!");
        }
    } catch (err) {
        console.error("Error occurred:", err.message);
    }
}

check();

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

async function verifyExportDate() {
    try {
        const sheetId = process.env.GOOGLE_SHEET_ID;
        const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

        const serviceAccountAuth = new JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();

        let summarySheet = doc.sheetsByTitle['Orders'] || doc.sheetsByIndex.find(s => s.title.toLowerCase().trim() === 'orders');
        
        // Force header update
        await summarySheet.setHeaderRow(['OrderID', 'Project', 'Destination', 'Timestamp', 'Week', 'Month', 'Year', 'Ngày xuất hàng', 'Status']);

        const now = new Date();
        const exportDate = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;
        
        const orderId = `DATE-TEST-${Date.now().toString().slice(-4)}`;
        
        console.log(`Adding Order ${orderId} with Export Date: ${exportDate}`);
        await summarySheet.addRow({
            'OrderID': orderId,
            'Project': 'test_date',
            'Destination': 'test_dest',
            'Timestamp': now.toLocaleString('vi-VN'),
            'Week': 99,
            'Month': 99,
            'Year': 99,
            'Ngày xuất hàng': exportDate,
            'Status': 'Date Test'
        });

        console.log("✅ Row with 'Ngày xuất hàng' added successfully!");

    } catch (err) {
        console.error("❌ Test Failed:", err);
    }
}

verifyExportDate();

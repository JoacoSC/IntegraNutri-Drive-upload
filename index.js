const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const multer = require('multer');
const { Readable } = require('stream');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const PORT = 3000;

const allowedOrigins = [
    'http://localhost:4000',         // Desarrollo local
    'https://testintegranutri.netlify.app', // Entorno de pruebas
    'https://integranutri.cl'       // Producción
];

app.use(cors({
    origin: function (origin, callback) {
        // Permite solicitudes sin origen (por ejemplo, desde herramientas de prueba)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Origen no permitido por CORS'));
        }
    }
}));

// Configura multer para manejar la carga de archivos
const upload = multer({ storage: multer.memoryStorage() });

// Configura Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.REDIRECT_URI
);

// Configura el ámbito de acceso a Google Drive
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Ruta para autenticar en Google Drive (primera vez)
app.get('/auth', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    res.redirect(authUrl);
});

// Callback para guardar tokens de Google OAuth
const fs = require('fs').promises;
const TOKEN_PATH = 'token.json';

app.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Guarda los tokens en un archivo
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        res.send('Autenticación exitosa. Puedes volver al frontend.');
    } catch (error) {
        console.error('Error en la autenticación:', error);
        res.status(500).send('Error en la autenticación');
    }
});

const initializeOAuth = async () => {
    try {
        const tokenData = await fs.readFile(TOKEN_PATH);
        oauth2Client.setCredentials(JSON.parse(tokenData));
        console.log('Tokens cargados exitosamente');
    } catch (error) {
        console.log('No se encontraron tokens guardados, por favor autentica en /auth');
    }
};

initializeOAuth();  // Llama a esta función al iniciar el servidor

const folderId = '1TWr1ugBhUbHJnbs6DD_8wnCXnmCLMbf-';  // Reemplaza con el ID de tu carpeta

// Ruta para subir archivo a Google Drive
app.post('/upload', upload.single('pdf'), async (req, res) => {
    if (!oauth2Client.credentials) {
        return res.status(403).send('No estás autenticado con Google Drive. Visita /auth para autenticarte.');
    }

    try {
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        // Convertir el buffer en un ReadableStream
        const fileStream = Readable.from(req.file.buffer);

        const response = await drive.files.create({
            requestBody: {
                name: `Informe_Antropometrico_${Date.now()}.pdf`,
                mimeType: 'application/pdf',
                parents: [folderId]  // Coloca el archivo en la carpeta especificada
            },
            media: {
                mimeType: 'application/pdf',
                body: fileStream,  // Pasar el archivo como ReadableStream
            },
        });

        const fileId = response.data.id;

        // Hacer que el archivo sea público
        await drive.permissions.create({
            fileId: fileId,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        // Obtener el enlace de descarga
        const result = await drive.files.get({
            fileId: fileId,
            fields: 'webViewLink, webContentLink',
        });

        res.json({ downloadLink: result.data.webViewLink });
    } catch (error) {
        console.error('Error al subir el archivo:', error);  // Log de error detallado en el backend
        res.status(500).json({ error: 'Error al subir el archivo a Google Drive' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

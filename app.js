// app.js
const express = require('express');
const axios = require('axios');
const multer = require('multer'); // Para upload de arquivos
const fs = require('fs'); // Para manipulação de arquivos
const path = require('path');
const pdfParse = require('pdf-parse'); // Para extrair texto de PDF
require('dotenv').config(); 

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.resolve(__dirname)));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY; 
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';

// Configuração do Multer para upload de arquivos
// Armazenar em memória para processamento e depois descartar
const storage = multer.memoryStorage(); // Melhor para não salvar arquivos temporários desnecessariamente
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Limite de 10 MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf', 'text/plain'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de arquivo inválido. Apenas arquivos PDF e TXT são permitidos.'));
        }
    }
});

// Função auxiliar para chamar a API da OpenAI (reutilizável)
async function getOpenAIAnalysis(textToAnalyze) {
    const prompt = `
Você é um assistente jurídico especializado em simplificar textos legais para leigos, chamado "IA Decifra".
Analise o seguinte texto jurídico fornecido pelo usuário. Sua tarefa é:
1.  **Resumo Principal:** Forneça um resumo conciso do propósito geral do texto em linguagem simples (1-2 frases).
2.  **Tradução de Jargões:** Identifique até 5-7 jargões ou termos técnicos complexos no texto e explique cada um de forma clara e simples, como se estivesse explicando para alguém sem nenhum conhecimento jurídico.
3.  **Pontos de Atenção / "Bandeiras Vermelhas":** Se identificar cláusulas que podem ser desvantajosas, ambíguas, confusas ou que mereçam atenção especial do usuário (potenciais "armadilhas", obrigações importantes, multas, renúncias de direito), liste até 3-5 desses pontos, explicando o porquê eles merecem atenção e qual o possível impacto para o usuário. Se não houver pontos óbvios de grande risco, mencione as obrigações principais ou os direitos mais relevantes que o texto estabelece.
4.  **Linguagem:** Use uma linguagem extremamente acessível, amigável e didática. Evite usar mais jargões ao explicar.
5.  **Formato da Resposta:** Organize a resposta de forma clara, usando títulos para cada seção (Ex: "Resumo Principal:", "Termos Simplificados:", "Pontos de Atenção:").

Texto jurídico para análise:
---
${textToAnalyze}
---
Análise do IA Decifra:
  `;

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: OPENAI_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 1500, // Aumentei um pouco caso o texto extraído seja grande
        },
        {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data.choices && response.data.choices.length > 0
        ? response.data.choices[0].message.content.trim()
        : 'Não foi possível gerar a análise a partir do texto fornecido.';
}


// ===============================
// IA DECIFRA - ENDPOINT PARA TEXTO
// ===============================
app.post('/api/decifra/text', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Nenhum texto fornecido para análise.' });
  }

  try {
    const analysis = await getOpenAIAnalysis(text);
    res.json({ analysis: analysis });
  } catch (error) {
    console.error('IA Decifra (Text) API Error:', error.response?.data || error.message);
    const errorMessage = error.response?.data?.error?.message || 'Falha na solicitação de análise de texto.';
    res.status(500).json({ error: errorMessage });
  }
});

// ===============================
// IA DECIFRA - ENDPOINT PARA ARQUIVO
// ===============================
app.post('/api/decifra/file', upload.single('legal_file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    let extractedText = '';

    try {
        if (req.file.mimetype === 'application/pdf') {
            const dataBuffer = req.file.buffer; // Usar o buffer do arquivo em memória
            const data = await pdfParse(dataBuffer);
            extractedText = data.text;
        } else if (req.file.mimetype === 'text/plain') {
            extractedText = req.file.buffer.toString('utf-8'); // Converter buffer para string
        } else {
            return res.status(400).json({ error: 'Tipo de arquivo não suportado para extração.' });
        }

        if (!extractedText.trim()) {
            return res.status(400).json({ error: 'Não foi possível extrair texto do arquivo ou o arquivo está vazio.' });
        }
        
        // Limitar o tamanho do texto extraído para evitar estouro de tokens na API da OpenAI
        const MAX_TEXT_LENGTH = 15000; // Ajuste este valor conforme necessário (considerando tokens)
        if (extractedText.length > MAX_TEXT_LENGTH) {
            extractedText = extractedText.substring(0, MAX_TEXT_LENGTH) + "\n\n[Texto truncado devido ao tamanho excessivo]";
            console.warn("Texto do arquivo truncado devido ao tamanho excessivo.")
        }


        const analysis = await getOpenAIAnalysis(extractedText);
        res.json({ analysis: analysis });

    } catch (error) {
        console.error('IA Decifra (File) API Error:', error.response?.data || error.message, error.stack);
        const userErrorMessage = error.message.includes('Tipo de arquivo inválido') 
            ? error.message 
            : (error.message.includes('Não foi possível extrair texto') ? error.message : 'Falha no processamento do arquivo.');
        res.status(500).json({ error: userErrorMessage });
    }
});


// Rota para a página principal
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'index.html'));
});

// ===============================
// START THE SERVER
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor IA Decifra rodando na porta ${PORT}`));

# 🚀 Guía de Deployment a Vercel - KaraoKey App

## ✅ Paso 1: Código Subido a GitHub
**COMPLETADO** ✓ 
- Repositorio: https://github.com/leandrosfierro/karaokey-app

---

## 📝 Paso 2: Desplegar en Vercel

### Opción A: Desde la Web (Recomendado para primera vez)

1. **Ir a Vercel**
   - Visita: https://vercel.com/new
   - Inicia sesión con tu cuenta de GitHub

2. **Importar Repositorio**
   - Busca y selecciona: `leandrosfierro/karaokey-app`
   - Click en "Import"

3. **Configurar Variables de Entorno** ⚙️
   - En la sección "Environment Variables", agrega:
   
   ```
   YOUTUBE_API_KEY=TU_YOUTUBE_API_KEY_AQUI
   ```

   **IMPORTANTE:** Necesitas una API Key de YouTube:
   - Ve a: https://console.cloud.google.com/apis/credentials
   - Crea un nuevo proyecto o selecciona uno existente
   - Habilita "YouTube Data API v3"
   - Crea credenciales (API Key)
   - Copia la key y pégala en Vercel

4. **Desplegar**
   - Click en "Deploy"
   - Espera 2-3 minutos
   - ¡Tu app estará online! 🎉

---

### Opción B: Desde Terminal (Avanzado)

Si prefieres usar la terminal:

```bash
# Instalar Vercel CLI
npm i -g vercel

# Login
vercel login

# Desplegar
vercel

# Configurar variables de entorno
vercel env add YOUTUBE_API_KEY

# Deploy a producción
vercel --prod
```

---

## 🔑 Obtener YouTube API Key

1. **Google Cloud Console**
   - https://console.cloud.google.com/

2. **Crear Proyecto**
   - Click en "Select a project" → "New Project"
   - Nombre: "KaraoKey App"
   - Click "Create"

3. **Habilitar API**
   - Menu → "APIs & Services" → "Library"
   - Busca "YouTube Data API v3"
   - Click "Enable"

4. **Crear Credenciales**
   - "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "API Key"
   - Copia la key generada

5. **Restricciones (Opcional pero recomendado)**
   - Click en la key recién creada
   - "Application restrictions" → "HTTP referrers"
   - Agrega: `https://tu-app.vercel.app/*` (reemplaza con tu dominio)
   - "API restrictions" → "Restrict key"
   - Selecciona: "YouTube Data API v3"
   - Save

---

## 🎯 Verificar Deployment

Una vez desplegado, verifica:

1. ✅ La aplicación carga correctamente
2. ✅ La ruleta de canciones funciona
3. ✅ El reproductor de YouTube carga
4. ✅ El crossfader mezcla las voces
5. ✅ Los controles de sincronización ajustan el audio

---

## 🔧 Troubleshooting

### Error: "YouTube API quota exceeded"
- La API gratuita tiene límite de 10,000 unidades/día
- Cada búsqueda consume ~100 unidades
- Solución: Espera 24h o solicita aumento de cuota

### Error: "Failed to fetch videos"
- Verifica que YOUTUBE_API_KEY esté configurada en Vercel
- Verifica que la API esté habilitada en Google Cloud

### El reproductor no carga
- Asegúrate de que el dominio de Vercel esté permitido en YouTube
- Verifica la consola del navegador para errores

---

## 📱 Dominios Personalizados (Opcional)

Si quieres un dominio propio:

1. Ve a tu proyecto en Vercel
2. Settings → Domains
3. Agrega tu dominio personalizado
4. Sigue las instrucciones de DNS

---

## 🔄 Futuras Actualizaciones

Para actualizar la app después del deployment inicial:

```bash
git add .
git commit -m "descripción de cambios"
git push
```

Vercel detectará automáticamente los cambios y redesplegará. 🚀

---

## 📞 Soporte

- Vercel Docs: https://vercel.com/docs
- YouTube API Docs: https://developers.google.com/youtube/v3

---

¡Tu KaraoKey App está lista para el mundo! 🎤🌎

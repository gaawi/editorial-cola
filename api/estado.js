// Medidor temporal: dice qué variables ve la función, sin enseñar su valor.
//
// Existe solo para desatascar la configuración de Vercel. En cuanto el login
// funcione, se borra: no es parte de la app.
export default function handler(req, res) {
  const hay = (n) => {
    const v = process.env[n];
    return v ? `sí (${String(v).length} caracteres)` : 'NO';
  };
  res.status(200).json({
    GITHUB_CLIENT_ID: hay('GITHUB_CLIENT_ID'),
    GITHUB_CLIENT_SECRET: hay('GITHUB_CLIENT_SECRET'),
    GITHUB_REPO: process.env.GITHUB_REPO || 'NO',
    COLA_LOGINS: process.env.COLA_LOGINS || '(vacía, es opcional)',
    // Por si hay una clave con un espacio o una mayúscula de más.
    parecidas: Object.keys(process.env).filter((k) => /GITHUB|COLA|CLIENT/i.test(k)).sort(),
  });
}

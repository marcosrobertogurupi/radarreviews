import nodemailer from 'nodemailer'

async function testPort(port: number) {
  console.log(`Testando porta ${port}...`)
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.netservice.net.br',
      port: port,
      secure: false,
      ignoreTLS: true,
      requireTLS: false,
      auth: {
        user: 'posvenda@netservice.net.br',
        pass: 'gauderio036927'
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      tls: {
        rejectUnauthorized: false
      }
    })

    await transporter.verify()
    console.log(`SUCESSO na porta ${port}!`)
    return true
  } catch (err: any) {
    console.error(`ERRO na porta ${port}:`, err.message)
    return false
  }
}

async function testAll() {
  await testPort(25)
  await testPort(587)
  await testPort(2525)
}

testAll()

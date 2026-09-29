import 'dotenv/config'
import { createApp } from './app'

const PORT = process.env.PORT ? Number(process.env.PORT) : 5000

const app = createApp()

app.listen(PORT, () => {
  console.log(`SmallBiz Lens API listening on port ${PORT}`)
})

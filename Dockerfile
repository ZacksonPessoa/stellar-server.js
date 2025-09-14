# immagem pequena com node 20
FROM node:20-alpine

# definir diretório de trabalho
WORKDIR /app

# copiar package.json e package-lock.json
COPY package*.json ./

# instalar dependências
RUN npm install

# copiar todo o código da aplicação
COPY . .

# expor a porta 4001
EXPOSE 4001

# iniciar a aplicação
#CMD ["node", "server.js"]
CMD ["npm", "start"]




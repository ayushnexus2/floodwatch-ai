# AWS deployment for FloodWatch AI

This project is ready for AWS App Runner deployment as a Docker container.

## 1) Prerequisites

- AWS account
- AWS CLI installed and configured
- Docker installed locally

Configure AWS credentials:

```bash
aws configure
```

## 2) Create a repository in Amazon ECR

```bash
aws ecr create-repository --repository-name floodwatch-ai --region ap-southeast-2
```

## 3) Log in to ECR

```bash
aws ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin <YOUR_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com
```

## 4) Build and push the container

```bash
docker build -t floodwatch-ai .
docker tag floodwatch-ai:latest <YOUR_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/floodwatch-ai:latest
docker push <YOUR_ACCOUNT_ID>.dkr.ecr.ap-southeast-2.amazonaws.com/floodwatch-ai:latest
```

## 5) Deploy to AWS App Runner

In the AWS Console:

1. Open AWS App Runner
2. Create an App Runner service
3. Choose "Container image"
4. Select the image from ECR
5. Set port to `8000`
6. Create the service

AWS App Runner will give you a live URL such as:

```text
https://<random-id>.awsapprunner.com
```

## 6) Test the deployed app

```bash
curl https://<your-app-runner-url>/api/health
curl https://<your-app-runner-url>/api/analyze?lat=28.6139\&lon=77.2090
```

## Notes

- This app serves the frontend and API from the same FastAPI process.
- App Runner is the simplest low-friction AWS host for this repo.

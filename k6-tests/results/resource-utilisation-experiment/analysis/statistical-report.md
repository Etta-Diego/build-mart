# Resource Utilisation Experiment - Statistical Report

## Enhanced

### 200 VUs
- Total pod CPU (millicores): N=15, mean=510.1, sd=140.2
- Avg pod memory (Mi): mean=53.3
- HPA CPU%: mean=50.3
- Replica count range: 2-2
- Throughput: 196.0 req/s
- Success rate: 99.91%

### 1000 VUs
- Total pod CPU (millicores): N=15, mean=2164.2, sd=821.0
- Avg pod memory (Mi): mean=50.9
- HPA CPU%: mean=77.8
- Replica count range: 2-8
- Throughput: 872.4 req/s
- Success rate: 99.87%

### 2000 VUs
- Total pod CPU (millicores): N=15, mean=4564.1, sd=1526.2
- Avg pod memory (Mi): mean=50.5
- HPA CPU%: mean=71.5
- Replica count range: 7-15
- Throughput: 1915.8 req/s
- Success rate: 99.90%

## Baseline

### 200 VUs
- PM2 CPU%: N=22, mean=28.33, sd=13.31
- PM2 memory (MB): mean=97.1
- Throughput: 197.8 req/s
- Success rate: 100.00%

### 1000 VUs
- PM2 CPU%: N=22, mean=116.23, sd=38.30
- PM2 memory (MB): mean=127.4
- Throughput: 624.7 req/s
- Success rate: 100.00%

### 2000 VUs
- PM2 CPU%: N=22, mean=116.34, sd=41.33
- PM2 memory (MB): mean=182.0
- Throughput: 598.9 req/s
- Success rate: 100.00%

## Monolith

### 200 VUs
- PM2 CPU%: N=22, mean=29.98, sd=9.96
- PM2 memory (MB): mean=147.7
- Throughput: 198.4 req/s
- Success rate: 100.00%

### 1000 VUs
- PM2 CPU%: N=22, mean=110.81, sd=36.09
- PM2 memory (MB): mean=166.0
- Throughput: 700.2 req/s
- Success rate: 100.00%

### 2000 VUs
- PM2 CPU%: N=22, mean=113.23, sd=34.75
- PM2 memory (MB): mean=220.7
- Throughput: 670.1 req/s
- Success rate: 100.00%

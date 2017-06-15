FROM ubuntu:14.04
MAINTAINER ruiming <ruiming.zhuang@gmail.com>

RUN apt-get update
RUN apt-get install -y gcc g++ cmake 
RUN apt-get install -y python3 python3-dev
RUN apt-get install -y git software-properties-common
RUN apt-get install -y libseccomp-dev
RUN git clone https://github.com/QingdaoU/Judger.git
RUN cd Judger && mkdir build && cd build && cmake .. && make && sudo make install
RUN cd Judger/bindings/Python && sudo python3 setup.py install

RUN rm -rf /var/lib/apt/lists/*
